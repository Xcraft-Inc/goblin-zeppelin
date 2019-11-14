'use strict';

const path = require('path');
const busClient = require('xcraft-core-busclient').getGlobal();
const goblinName = path.basename(module.parent.filename, '.js');
const {helpers} = require('xcraft-core-transport');
const {WebSocketChannel} = require('goblin-laboratory');
const Goblin = require('xcraft-core-goblin');

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

Goblin.registerQuest(goblinName, 'init', function(
  quest,
  mandate,
  themeContext,
  feeds,
  onConnect,
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
      const {token, socket, mandate, req, feeds, onConnect} = msg.data;
      quest.goblin.setX(`socket@${token}`, socket);
      yield resp.cmd(`${goblinName}.onConnection`, {
        token,
        mandate,
        req,
        feeds,
        onConnect,
      });
    })
  );

  const WebSocket = require('ws');
  const wss = new WebSocket.Server({port});
  wss.on('connection', (socket, req) => {
    //GET SESSION FROM REQUESTED URL
    const urlPaths = req.url.split('/');
    const token = urlPaths[1];
    resp.events.send(`${goblinName}.onboarding-requested`, {
      socket,
      token,
      mandate,
      req,
      feeds,
      onConnect,
    });
  });
});

Goblin.registerQuest(goblinName, 'onConnection', function*(
  quest,
  token,
  mandate,
  feeds,
  onConnect,
  $msg
) {
  const orcName = $msg.orcName;
  const resp = busClient.newResponse(goblinName, orcName);

  const socket = quest.goblin.getX(`socket@${token}`);
  const desktopId = `desktop@${mandate}@${token}`;
  quest.do({desktopId, token});
  const sessionInfo = quest.goblin
    .getState()
    .get(`sessions.${token}`)
    .toJS();
  const channel = new WebSocketChannel(socket);
  quest.goblin.setX(`channel@${desktopId}`, channel);
  const themeContext = quest.goblin.getX('themeContext');

  yield quest.me.subscribe({desktopId});

  const carnotzetId = `carnotzet@${desktopId}`;
  yield quest.createFor('carnotzet', carnotzetId, carnotzetId, {
    id: carnotzetId,
    desktopId,
    config: {feed: desktopId, feeds, themeContext},
  });

  //quest.cmd('warehouse.resend', {feed: desktopId});

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

  socket.on('close', function() {
    resp.events.send(`goblin.released`, {
      id: carnotzetId,
    });
    const unsub = quest.goblin.getX(`subs@${desktopId}`);
    unsub && unsub();
  });

  socket.on('error', function() {
    resp.events.send(`goblin.released`, {
      id: carnotzetId,
    });
    const unsub = quest.goblin.getX(`subs@${desktopId}`);
    unsub && unsub();
  });

  yield quest.cmd(`${onConnect.goblin}.${onConnect.quest}`, {
    id: onConnect.goblinId,
    labId: carnotzetId,
    desktopId,
    sessionInfo,
  });

  yield quest.warehouse.syncChanges({feed: desktopId});

  channel.beginRender(carnotzetId);
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
