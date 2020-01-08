'use strict';

const path = require('path');
const busClient = require('xcraft-core-busclient').getGlobal();
const xBus = require('xcraft-core-bus');
const goblinName = path.basename(module.parent.filename, '.js');
const {helpers} = require('xcraft-core-transport');
const {WebSocketChannel} = require('goblin-laboratory');
const Goblin = require('xcraft-core-goblin');
const {crypto} = require('xcraft-core-utils');

// Define initial logic values
const logicState = {
  sessions: {},
};

// Define logic handlers according rc.json
const logicHandlers = {
  onConnection: (state, action) => {
    const token = action.get('token');
    const desktopId = action.get('desktopId');
    const existing = state.get(`sessions.${token}`);
    if (existing) {
      return state.set(`sessions.${token}`, {
        desktopId,
        token,
        lastConnection: new Date(),
      });
    } else {
      return state.set(`sessions.${token}`, {
        desktopId,
        token,
        lastConnection: new Date(),
        user: 'guest',
      });
    }
  },
};

const onQuest = (resp, evt, action) => {
  const _action = helpers.fromXcraftJSON(action)[0];
  resp.command.send(_action.cmd, _action.data, err => {
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

Goblin.registerQuest(goblinName, 'init', function(
  quest,
  mandate,
  themeContext,
  feeds,
  onConnect,
  onDisconnect,
  port = 8000,
  $msg
) {
  const orcName = $msg.orcName;
  const resp = busClient.newResponse(goblinName, orcName);
  quest.goblin.setX('themeContext', themeContext);

  quest.goblin.defer(
    quest.sub(`*::${goblinName}.onboarding-requested`, function*(
      err,
      {msg, resp}
    ) {
      const {
        token,
        destination,
        socket,
        mandate,
        req,
        feeds,
        onConnect,
        onDisconnect,
      } = msg.data;
      yield resp.cmd(`${goblinName}.onConnection`, {
        socket,
        token,
        destination,
        mandate,
        req,
        feeds,
        onConnect,
        onDisconnect,
      });
    })
  );

  quest.goblin.defer(
    quest.sub(`*::${goblinName}.disembark-requested`, function*(
      err,
      {msg, resp}
    ) {
      const {carnotzetId, desktopId, onDisconnect} = msg.data;
      yield resp.cmd(`${goblinName}.dispose`, {
        carnotzetId,
        desktopId,
        onDisconnect,
      });
    })
  );

  const WebSocket = require('ws');
  const wss = new WebSocket.Server({port});
  wss.on('connection', (socket, req) => {
    socket.isAlive = true;
    //Pong messages are automatically sent in response to ping messages
    socket.on('pong', heartbeat);
    const [_, token, destination] = req.url.match(/^\/([^/]*)\/(.*)$/);

    resp.events.send(`${goblinName}.onboarding-requested`, {
      socket,
      token,
      destination,
      mandate,
      req,
      feeds,
      onConnect,
      onDisconnect,
    });
  });

  setInterval(function ping() {
    wss.clients.forEach(socket => {
      if (socket.isAlive === false) {
        return socket.terminate();
      }
      socket.isAlive = false;
      socket.ping(noop);
    });
  }, 30000);
});

Goblin.registerQuest(goblinName, 'onConnection', function*(
  quest,
  req,
  socket,
  token,
  destination,
  mandate,
  feeds,
  onConnect,
  onDisconnect,
  $msg
) {
  let zeppelinSessionId = `zeppelin-session@${token}`;
  let desktopId;

  const existingClientSession = yield quest.warehouse.get({
    path: zeppelinSessionId,
  });

  let mustResend = false;
  if (!existingClientSession) {
    token = crypto.genToken();
    zeppelinSessionId = `zeppelin-session@${token}`;
    desktopId = `desktop@${mandate}@${token}`;
  } else {
    desktopId = `desktop@${mandate}@${token}`;
    mustResend = true;
  }

  //detect remote ip
  let ip = req.connection.remoteAddress;
  const forwardedFor = req.headers['x-forwarded-for']; //behind nginx case
  if (forwardedFor) {
    ip = forwardedFor.split(/\s*,\s*/)[0];
  }

  quest.log.verb(`client ${ip} onboarding...`);
  const orcName = $msg.orcName;
  const resp = busClient.newResponse(goblinName, orcName);

  yield quest.createFor(
    'zeppelin-session',
    `goblin-cache@${xBus.getToken()}`,
    zeppelinSessionId,
    {id: zeppelinSessionId, desktopId, _goblinTTL: 60000 * 60}
  );

  //TODO::: ???
  quest.do({desktopId, token});
  const sessionInfo = quest.goblin
    .getState()
    .get(`sessions.${token}`)
    .toJS();

  const channel = new WebSocketChannel(socket);
  quest.goblin.setX(`channel@${desktopId}`, channel);
  const themeContext = quest.goblin.getX('themeContext');

  yield quest.me.subscribe({desktopId});

  //client-session->carnotzet
  const carnotzetId = `carnotzet@${desktopId}`;
  yield quest.createFor('carnotzet', zeppelinSessionId, carnotzetId, {
    id: carnotzetId,
    desktopId,
    clientSessionId: zeppelinSessionId,
    config: {feed: desktopId, feeds, themeContext},
  });

  channel.sendAction({
    type: 'COMMANDS_REGISTRY',
    commands: quest.resp.getCommandsNames(),
  });

  socket.on('message', function(data) {
    data = JSON.parse(data);
    switch (data.type) {
      case 'QUEST': {
        onQuest(resp, null, data.data);
        break;
      }
      case 'DATA_TRANSFER': {
        onDataTransfer(resp, null, data.data);
        break;
      }
    }
  });

  const disembarkRequest = () =>
    resp.events.send(`${goblinName}.disembark-requested`, {
      desktopId,
      carnotzetId,
      onDisconnect,
    });

  socket.on('close', disembarkRequest);

  socket.on('error', disembarkRequest);

  //TODO:Speedup the end of quest by delegation
  try {
    yield quest.cmd(`${onConnect.goblin}.${onConnect.quest}`, {
      id: onConnect.goblinId,
      labId: carnotzetId,
      desktopId,
      sessionInfo,
      token,
      destination,
    });
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

  channel.beginRender(carnotzetId, token);
});

Goblin.registerQuest(goblinName, 'dispose', function*(
  quest,
  carnotzetId,
  desktopId,
  onDisconnect
) {
  const unsub = quest.goblin.getX(`subs@${desktopId}`);
  unsub && unsub();
  quest.goblin.delX(`subs@${desktopId}`);
  quest.goblin.delX(`channel@${desktopId}`);

  if (onDisconnect) {
    yield quest.cmd(`${onDisconnect.goblin}.${onDisconnect.quest}`, {
      id: onDisconnect.goblinId,
      labId: carnotzetId,
      desktopId,
    });
  }
});

Goblin.registerQuest(
  goblinName,
  'subscribe',
  function(quest, desktopId) {
    const channel = quest.goblin.getX(`channel@${desktopId}`);
    const subs = [
      quest.sub(`*::warehouse.${desktopId}.changed`, (err, {msg}) => {
        channel.sendBackendState(msg);
      }),

      quest.sub(`${desktopId}.nav.requested`, function*(err, {msg, resp}) {
        yield resp.cmd(`${goblinName}.nav`, {
          id: goblinName,
          desktopId,
          route: msg.data.route,
        });
      }),

      quest.sub(`${desktopId}.dispatch.requested`, function*(err, {msg, resp}) {
        yield resp.cmd(`${goblinName}.dispatch`, {
          id: goblinName,
          desktopId,
          action: msg.data.action,
        });
      }),
    ];

    quest.goblin.setX(`subs@${desktopId}`, () => {
      subs.forEach(unsub => unsub());
    });
  },
  ['*::warehouse.*.changed']
);

Goblin.registerQuest(goblinName, 'nav', function(quest, desktopId, route) {
  const channel = quest.goblin.getX(`channel@${desktopId}`);
  if (channel) {
    channel.sendPushPath(route);
  }
});

Goblin.registerQuest(goblinName, 'dispatch', function(
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
