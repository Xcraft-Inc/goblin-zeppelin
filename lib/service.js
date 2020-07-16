'use strict';

const path = require('path');
const busClient = require('xcraft-core-busclient').getGlobal();
const xBus = require('xcraft-core-bus');
const goblinName = path.basename(module.parent.filename, '.js');
const {helpers} = require('xcraft-core-transport');
const {WebSocketChannel} = require('goblin-laboratory');
const Goblin = require('xcraft-core-goblin');
const {crypto} = require('xcraft-core-utils');
const buildCommandsFilter = require('./buildCommandsFilter.js');
const zeppelinConfig = require('xcraft-core-etc')().load('goblin-zeppelin');

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

const onQuest = (resp, evt, action) => {
  const _action = helpers.fromXcraftJSON(action)[0];
  resp.command.send(_action.cmd, _action.data, (err) => {
    if (err) {
      console.warn(`Failed UI command: ${_action.cmd}
      ${err.message}`);
    }
  });
};

const onDataTransfer = (resp, evt, action) => {
  resp.events.send(`data-transfer.requested`, action);
  onQuest(resp, evt, {
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
  host,
  port,
  $msg
) {
  host = host || zeppelinConfig.host || '0.0.0.0';
  port = port || zeppelinConfig.port || 8000;

  const orcName = $msg.orcName;
  const resp = busClient.newResponse(goblinName, orcName);
  quest.goblin.setX('theme', theme);
  quest.goblin.setX('themeContexts', themeContexts);

  quest.goblin.setX(`clientTokens`, new Set());

  quest.goblin.defer(
    quest.sub(`*::${goblinName}.onboarding-requested`, function* (
      err,
      {msg, resp}
    ) {
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
    })
  );

  quest.goblin.defer(
    quest.sub(`*::${goblinName}.disembark-requested`, function* (
      err,
      {msg, resp}
    ) {
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
    })
  );

  const WebSocket = require('ws');
  const wss = new WebSocket.Server({host, port});
  wss.on('connection', (socket, req) => {
    socket.isAlive = true;
    //Pong messages are automatically sent in response to ping messages
    socket.on('pong', heartbeat);

    resp.events.send(`${goblinName}.onboarding-requested`, {
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

  let [_, clientToken, sessionToken, destination] = req.url.match(
    /^\/([^/]*)\/([^/]*)\/(.*)$/
  );

  const clientTokens = quest.goblin.getX(`clientTokens`);
  if (!clientTokens.has(clientToken)) {
    clientToken = crypto.genToken();
  }

  const existingSession = yield quest.warehouse.get({
    path: `zeppelin-session@${sessionToken}`,
  });
  if (!existingSession) {
    sessionToken = crypto.genToken();
  }

  const tokens = {
    clientToken,
    sessionToken,
  };

  // Detect remote ip
  let ip = req.connection.remoteAddress;
  const forwardedFor = req.headers['x-forwarded-for']; //behind nginx case
  if (forwardedFor) {
    ip = forwardedFor.split(/\s*,\s*/)[0];
  }

  quest.log.verb(`client ${ip} onboarding...`);
  const orcName = $msg.orcName;
  const resp = busClient.newResponse(goblinName, orcName);

  const channel = new WebSocketChannel(socket);
  quest.goblin.setX(`channel@${socketId}`, channel);

  const zeppelinSessionId = `zeppelin-session@${sessionToken}`;
  const desktopId = `desktop@${mandate}@${sessionToken}`;
  const carnotzetId = `carnotzet@${desktopId}`;
  const existingCarnotzet = yield quest.warehouse.get({
    path: carnotzetId,
  });
  // TODO: Check if the condition for mustResend is correct
  const mustResend = Boolean(existingCarnotzet);

  const disembarkRequest = () =>
    resp.events.send(`${goblinName}.disembark-requested`, {
      socketId,
      zeppelinSessionId,
      carnotzetId,
      desktopId,
      tokens,
      onDisconnect,
    });

  socket.on('close', disembarkRequest);
  socket.on('error', disembarkRequest);

  yield quest.me.subscribe({socketId, desktopId});

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

  channel.sendAction({
    type: 'COMMANDS_REGISTRY',
    commands: quest.resp.getCommandsNames(),
  });

  socket.on('message', function (payload) {
    payload = JSON.parse(payload);
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
        messageError: 'not-allowed-cmd',
        desktopId,
        ip,
      });
      socket.terminate();
      disembarkRequest();
      return;
    }
    switch (payload.type) {
      case 'QUEST': {
        onQuest(resp, null, payload.data);
        break;
      }
      case 'DATA_TRANSFER': {
        onDataTransfer(resp, null, payload.data);
        break;
      }
    }
  });

  //TODO:Speedup the end of quest by delegation
  let onConnectResult;
  try {
    onConnectResult = yield quest.cmd(
      `${onConnect.goblin}.${onConnect.quest}`,
      {
        id: onConnect.goblinId,
        labId: carnotzetId,
        desktopId,
        tokens,
        destination,
      }
    );
  } catch (err) {
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
    try {
      yield quest.cmd(`${onBeginRender.goblin}.${onBeginRender.quest}`, {
        id: onBeginRender.goblinId,
        labId: carnotzetId,
        desktopId,
        tokens,
        onConnectResult,
      });
    } catch (err) {
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
  const unsub = quest.goblin.getX(`subs@${socketId}`);
  unsub && unsub();
  quest.goblin.delX(`subs@${socketId}`);
  quest.goblin.delX(`channel@${socketId}`);

  if (onDisconnect) {
    yield quest.cmd(`${onDisconnect.goblin}.${onDisconnect.quest}`, {
      id: onDisconnect.goblinId,
      labId: carnotzetId,
      desktopId,
      tokens,
    });
  }

  yield quest.createFor(
    'zeppelin-session',
    `goblin-cache@${xBus.getToken()}`,
    zeppelinSessionId,
    {id: zeppelinSessionId, desktopId, _goblinTTL: 60 * 1000}
  );
  yield quest.kill([zeppelinSessionId]);
});

Goblin.registerQuest(
  goblinName,
  'subscribe',
  function (quest, socketId, desktopId) {
    const channel = quest.goblin.getX(`channel@${socketId}`);
    const oldSubs = quest.goblin.getX(`subs@${socketId}`);
    if (oldSubs) {
      throw new Error('Already subscribed');
    }
    const subs = [
      quest.sub(`*::warehouse.${desktopId}.changed`, (err, {msg}) => {
        channel.sendBackendState(msg);
      }),

      quest.sub(`${desktopId}.nav.requested`, function* (err, {msg, resp}) {
        yield resp.cmd(`${goblinName}.nav`, {
          id: goblinName,
          desktopId,
          route: msg.data.route,
        });
      }),

      quest.sub(`${desktopId}.dispatch.requested`, function* (
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

    quest.goblin.setX(`subs@${socketId}`, () => {
      subs.forEach((unsub) => unsub());
    });
  },
  ['*::warehouse.*.changed']
);

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
