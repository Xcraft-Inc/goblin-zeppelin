'use strict';

const path = require('path');
const busClient = require('xcraft-core-busclient').getGlobal();
const goblinName = path.basename(module.parent.filename, '.js');
const {helpers} = require('xcraft-core-transport');
const {WebSocketChannel} = require('goblin-laboratory');
const Goblin = require('xcraft-core-goblin');
const {crypto} = require('xcraft-core-utils');
const {
  buildCommandsFilter,
  buildAllowedCommandsList,
} = require('./buildCommandsFilter.js');
const zeppelinConfig = require('xcraft-core-etc')().load('goblin-zeppelin');
const {locks} = require('xcraft-core-utils');

let allowed = () => true;
if (zeppelinConfig.allowedCommands) {
  if (zeppelinConfig.allowedCommands.length > 0) {
    allowed = buildCommandsFilter(zeppelinConfig.allowedCommands);
  }
}

// Define initial logic values
const logicState = {
  sessions: {},
};

// Define logic handlers according rc.json
const logicHandlers = {};

const block = (resp, action) => {
  console.warn(
    `⚠️OVERWATCH⚠️ ERR:${action.messageError} REMOTE IP: ${action.ip}`
  );
  //TODO: impl. overwatch goblin (security service)
  /*resp.command.send(`overwatch.block`, _action.data, err => {
    if (err) {
      console.warn(`Failed overwatch block command: ${_action.cmd}
      ${err.message}`);
    }
  });*/
};

const injectGoblinUser = (resp, data) => {
  //prevent props injection
  if (data._goblinUser) {
    delete data._goblinUser;
  }

  //by default provide a footprint
  data._goblinUser = Goblin.buildRemoteGuestFootprint(resp.clientCtx);

  const {getLoginState, zeppelinSessionId, socketId} = resp.clientCtx;
  const loginState = getLoginState();
  if (loginState) {
    const {userId, login, isLogged} = loginState;
    if (isLogged) {
      data._goblinUser = `${userId}@${login}@${zeppelinSessionId}@${socketId}`;
    }
  }
};

const sendCommand = (resp, action) => {
  const _action = helpers.fromXcraftJSON(action)[0];
  injectGoblinUser(resp, _action.data);
  resp.command.send(_action.cmd, _action.data, (err) => {
    if (err) {
      console.warn(`Failed UI command: ${_action.cmd}
      ${err.message}`);
    }
  });
};

const onQuest = (resp, action) => {
  sendCommand(resp, action);
};

const onDataTransfer = (resp, action) => {
  resp.events.send(`data-transfer.requested`, action);
  sendCommand(resp, {
    cmd: 'client.data-transfer',
    data: {id: 'client', ...action},
  });
};

function noop() {}

function heartbeat() {
  this.isAlive = true;
}

Goblin.registerQuest(goblinName, 'init', function (
  quest,
  mandate,
  theme,
  themeContexts,
  feeds,
  onConnect,
  onBeginRender,
  onDisconnect,
  server,
  host,
  port,
  $msg
) {
  host = host || zeppelinConfig.host || '0.0.0.0';
  port = port || zeppelinConfig.port || 8000;

  const orcName = $msg.orcName;
  const routing = {
    router: $msg.router,
    originRouter: $msg.originRouter,
  };
  const resp = busClient.newResponse(goblinName, orcName, routing);
  quest.goblin.setX('theme', theme);
  quest.goblin.setX('themeContexts', themeContexts);

  quest.goblin.setX(`clientTokens`, new Set());
  quest.goblin.setX(`sessionTokensToKill`, new Set());
  quest.goblin.setX(`sessionKillTimeouts`, new Map());

  quest.goblin.defer(
    quest.sub.local(
      `greathall::${goblinName}.<onboarding-requested>`,
      function* (err, {msg, resp}) {
        const {
          socket,
          mandate,
          req,
          feeds,
          onConnect,
          onBeginRender,
          onDisconnect,
        } = msg.data;
        yield resp.cmd(`${goblinName}.onConnection`, {
          socket,
          mandate,
          req,
          feeds,
          onConnect,
          onBeginRender,
          onDisconnect,
        });
      }
    )
  );

  quest.goblin.defer(
    quest.sub.local(
      `greathall::${goblinName}.<disembark-requested>`,
      function* (err, {msg, resp}) {
        const {
          socketId,
          zeppelinSessionId,
          carnotzetId,
          desktopId,
          tokens,
          onDisconnect,
        } = msg.data;
        yield resp.cmd(`${goblinName}.dispose`, {
          socketId,
          zeppelinSessionId,
          carnotzetId,
          desktopId,
          tokens,
          onDisconnect,
        });
      }
    )
  );

  const WebSocket = require('ws');
  const wss = new WebSocket.Server(server ? {server} : {host, port});
  wss.on('connection', (socket, req) => {
    socket.isAlive = true;
    //Pong messages are automatically sent in response to ping messages
    socket.on('pong', heartbeat);

    resp.events.send(`greathall::${goblinName}.<onboarding-requested>`, {
      socket,
      mandate,
      req,
      feeds,
      onConnect,
      onBeginRender,
      onDisconnect,
    });
  });

  setInterval(function ping() {
    wss.clients.forEach((socket) => {
      if (socket.isAlive === false) {
        return socket.terminate();
      }
      socket.isAlive = false;
      socket.ping(noop);
    });
  }, 30000);
});

//retreive websocket headers cookie
function getCookie(req, name) {
  const cookies = req.headers.cookie;
  if (!cookies) {
    return null;
  }
  for (const cookie of cookies.split(';')) {
    const [key, value] = cookie.split('=');
    if (key.trim() === name) {
      return value;
    }
  }
  return null;
}

const socketConn = locks.getMutex;
Goblin.registerQuest(goblinName, 'onConnection', function* (
  quest,
  req,
  socket,
  mandate,
  feeds,
  onConnect,
  onBeginRender,
  onDisconnect,
  $msg
) {
  const socketId = quest.uuidV4();

  yield socketConn.lock(socketId);
  quest.defer(() => socketConn.unlock(socketId));

  let [_, clientToken, sessionToken, destination] = req.url.match(
    /^\/([^/]*)\/([^/]*)\/(.*)$/
  );

  let loginSessionToken;
  //todo: use config
  const superClientToken = getCookie(req, 'epsitec-client-token');
  if (superClientToken) {
    clientToken = superClientToken;
    loginSessionToken = superClientToken;
  }
  const clientTokens = quest.goblin.getX(`clientTokens`);
  if (!clientTokens.has(clientToken)) {
    if (clientToken === 'new-token') {
      clientToken = crypto.genToken();
    }
  }

  // const existingSession = yield quest.warehouse.get({
  //   path: `zeppelin-session@${sessionToken}`,
  // });
  // if (!existingSession) {
  //   sessionToken = crypto.genToken();
  // }
  const sessionKillTimeouts = quest.goblin.getX(`sessionKillTimeouts`);
  const sessionTokensToKill = quest.goblin.getX(`sessionTokensToKill`);
  if (sessionKillTimeouts.has(sessionToken)) {
    clearTimeout(sessionKillTimeouts.get(sessionToken));
    sessionKillTimeouts.delete(sessionToken);

    if (sessionTokensToKill.has(sessionToken)) {
      sessionToken = crypto.genToken();
      //sessionTokensToKill.delete(sessionToken);
    }
  } else {
    sessionToken = crypto.genToken();
  }

  const tokens = {
    clientToken,
    sessionToken,
  };

  const zeppelinSessionId = `zeppelin-session@${sessionToken}`;
  const desktopId = `desktop@${mandate}@${sessionToken}$passenger`;
  const carnotzetId = `carnotzet@${desktopId}`;
  const existingCarnotzet = yield quest.warehouse.get({
    path: carnotzetId,
  });

  ////////////////////////////////////////////////////////
  /// Begin SYNC only stuff                            ///
  ////////////////////////////////////////////////////////

  if (socket.readyState !== socket.OPEN) {
    socket.terminate();
    return;
  }

  // TODO: Check if the condition for mustResend is correct
  const mustResend = Boolean(existingCarnotzet);

  // Detect remote ip
  let ip = req.connection.remoteAddress;
  const forwardedFor = req.headers['x-forwarded-for']; //behind nginx case
  if (forwardedFor) {
    ip = forwardedFor.split(/\s*,\s*/)[0];
  }

  quest.log.verb(`client ${ip} onboarding...`);
  const orcName = $msg.orcName;
  const routing = {
    router: $msg.router,
    originRouter: $msg.originRouter,
  };
  const resp = busClient.newResponse(goblinName, orcName, routing);
  const getLoginState = () => quest.goblin.getX(`loginState@${socketId}`);
  resp.clientCtx = {ip, socketId, zeppelinSessionId, getLoginState};
  const disembarkRequest = () =>
    resp.events.send(`greathall::${goblinName}.<disembark-requested>`, {
      socketId,
      zeppelinSessionId,
      carnotzetId,
      desktopId,
      tokens,
      onDisconnect,
    });

  socket.on('close', disembarkRequest);
  socket.on('error', disembarkRequest);

  const channel = new WebSocketChannel(socket);
  quest.goblin.setX(`channel@${socketId}`, channel);

  ////////////////////////////////////////////////////////
  /// End of SYNC only stuff                           ///
  ////////////////////////////////////////////////////////
  yield quest.me.subscribe({
    socketId,
    desktopId,
    loginSessionToken,
  });

  yield quest.create(zeppelinSessionId, {id: zeppelinSessionId, desktopId});

  //client-session->carnotzet
  const theme = quest.goblin.getX('theme');
  const themeContexts = quest.goblin.getX('themeContexts');
  yield quest.createFor('carnotzet', zeppelinSessionId, carnotzetId, {
    id: carnotzetId,
    desktopId,
    clientSessionId: zeppelinSessionId,
    config: {feed: desktopId, feeds, theme, themeContexts},
  });

  let commands;
  if (zeppelinConfig.allowedCommands) {
    commands = buildAllowedCommandsList(zeppelinConfig.allowedCommands);
  } else {
    commands = quest.resp.getCommandsNames();
  }
  channel.sendAction({
    type: 'COMMANDS_REGISTRY',
    commands,
  });

  socket.on('message', function (payload) {
    payload = JSON.parse(payload);

    if (payload.type === 'QUEST' || payload.type === 'DATA_TRANSFER') {
      if (!payload.data.data.desktopId) {
        block(resp, {
          data: payload.data,
          messageError: 'no-desktop-id',
          desktopId,
          ip,
        });
        socket.terminate();
        disembarkRequest();
        return;
      }
      if (payload.data.data.desktopId !== desktopId) {
        block(resp, {
          data: payload.data,
          messageError: 'bad-desktop-id',
          desktopId,
          ip,
        });
        socket.terminate();
        disembarkRequest();
        return;
      }
      if (!allowed(payload.data.cmd)) {
        block(resp, {
          data: payload.data,
          messageError: `not-allowed-cmd: ${payload.data.cmd}`,
          desktopId,
          ip,
        });
        socket.terminate();
        disembarkRequest();
        return;
      }
    }

    switch (payload.type) {
      case 'QUEST': {
        onQuest(resp, payload.data);
        break;
      }
      case 'DATA_TRANSFER': {
        onDataTransfer(resp, payload.data);
        break;
      }
      case `RESEND`: {
        sendCommand(resp, {
          cmd: 'warehouse.resend',
          data: {feed: desktopId},
        });
        channel.sendAction({
          type: 'COMMANDS_REGISTRY',
          commands,
        });
        channel.beginRender(carnotzetId, tokens);
        break;
      }
    }
  });

  //TODO:Speedup the end of quest by delegation
  let onConnectResult;
  const data = {
    id: onConnect.goblinId,
    labId: carnotzetId,
    desktopId,
    req,
    tokens,
    destination,
  };
  injectGoblinUser(resp, data);
  try {
    onConnectResult = yield quest.cmd(
      `${onConnect.goblin}.${onConnect.quest}`,
      data
    );
  } catch (err) {
    socket.close(4001);
    socket.terminate();
    disembarkRequest();
    return;
  }

  yield quest.warehouse.syncChanges({feed: desktopId});
  if (mustResend) {
    yield quest.warehouse.resend({feed: desktopId});
  }
  quest.log.verb(`client ${ip} onboarding...[DONE]`);

  channel.beginRender(carnotzetId, tokens);

  if (onBeginRender) {
    const data = {
      id: onBeginRender.goblinId,
      labId: carnotzetId,
      desktopId,
      tokens,
      onConnectResult,
    };
    injectGoblinUser(resp, data);
    try {
      yield quest.cmd(`${onBeginRender.goblin}.${onBeginRender.quest}`, data);
    } catch (err) {
      socket.close(4001);
      socket.terminate();
      disembarkRequest();
      return;
    }
  }
});

Goblin.registerQuest(goblinName, 'dispose', function* (
  quest,
  socketId,
  zeppelinSessionId,
  carnotzetId,
  desktopId,
  tokens,
  onDisconnect
) {
  yield socketConn.lock(socketId);
  quest.defer(() => socketConn.unlock(socketId));

  const unsub = quest.goblin.getX(`subs@${socketId}`);
  unsub && unsub();
  quest.goblin.delX(`subs@${socketId}`);
  quest.goblin.delX(`channel@${socketId}`);
  quest.goblin.delX(`loginState@${socketId}`);

  if (onDisconnect) {
    yield quest.cmd(`${onDisconnect.goblin}.${onDisconnect.quest}`, {
      id: onDisconnect.goblinId,
      labId: carnotzetId,
      desktopId,
      tokens,
    });
  }

  const sessionKillTimeouts = quest.goblin.getX(`sessionKillTimeouts`);
  const sessionTokensToKill = quest.goblin.getX(`sessionTokensToKill`);
  const timeout = setTimeout(() => {
    sessionTokensToKill.add(tokens.sessionToken);
    quest.kill([zeppelinSessionId]); // TODO handle errors
    setTimeout(() => {
      sessionTokensToKill.delete(tokens.sessionToken);
    }, 60 * 1000);
  }, 60 * 1000);
  sessionKillTimeouts.set(tokens.sessionToken, timeout);
});

Goblin.registerQuest(goblinName, 'subscribe', function* (
  quest,
  socketId,
  desktopId,
  loginSessionToken
) {
  const channel = quest.goblin.getX(`channel@${socketId}`);
  const oldSubs = quest.goblin.getX(`subs@${socketId}`);
  if (oldSubs) {
    throw new Error('Already subscribed');
  }
  const subs = [
    quest.sub(`*::warehouse.<${desktopId}>.changed`, (err, {msg}) => {
      channel.sendBackendState(msg);
    }),

    quest.sub(`*::<${desktopId}>.nav.requested`, function* (err, {msg, resp}) {
      yield resp.cmd(`${goblinName}.nav`, {
        id: goblinName,
        desktopId,
        route: msg.data.route,
      });
    }),

    quest.sub(`*::<${desktopId}>.dispatch.requested`, function* (
      err,
      {msg, resp}
    ) {
      yield resp.cmd(`${goblinName}.dispatch`, {
        id: goblinName,
        desktopId,
        action: msg.data.action,
      });
    }),
  ];

  if (loginSessionToken) {
    const setLoginState = (state) => {
      quest.goblin.setX(`loginState@${socketId}`, state);
    };
    const loginSessionState = yield quest.warehouse.get({
      path: `login-session@${loginSessionToken}`,
    });
    if (loginSessionState) {
      const {userId, login, isLogged} = loginSessionState.pick(
        'userId',
        'login',
        'isLogged'
      );
      setLoginState({userId, login, isLogged});
    }
    subs.push(
      quest.sub(
        `*::login-session@${loginSessionToken}.<login-state-changed>`,
        function (_, {msg}) {
          setLoginState(msg.data);
        }
      )
    );
  }

  quest.goblin.setX(`subs@${socketId}`, () => {
    subs.forEach((unsub) => unsub());
  });
});

Goblin.registerQuest(goblinName, 'nav', function (quest, desktopId, route) {
  const channel = quest.goblin.getX(`channel@${desktopId}`);
  if (channel) {
    channel.sendPushPath(route);
  }
});

Goblin.registerQuest(goblinName, 'dispatch', function (
  quest,
  desktopId,
  action
) {
  const channel = quest.goblin.getX(`channel@${desktopId}`);
  if (channel) {
    channel.sendAction(action);
  }
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
