'use strict';

const path = require('path');
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

const onQuest = (quest, evt, action) => {
  const _action = helpers.fromXcraftJSON(action)[0];
  quest.cmd(_action.cmd, _action.data);
};

Goblin.registerQuest(goblinName, 'init', function(
  quest,
  mandate,
  feeds,
  onConnect,
  port = 8000
) {
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({port});
  wss.on('connection', (socket, req) => {
    //GET SESSION FROM REQUESTED URL
    const urlPaths = req.url.split('/');
    const token = urlPaths[1];
    quest.goblin.setX(`socket@${token}`, socket);
    quest.me.onConnection({token, mandate, req, feeds, onConnect});
  });
});

Goblin.registerQuest(goblinName, 'onConnection', function*(
  quest,
  token,
  mandate,
  feeds,
  onConnect
) {
  const socket = quest.goblin.getX(`socket@${token}`);
  const desktopId = `desktop@${mandate}@${token}`;
  quest.do({desktopId, token});
  const sessionInfo = quest.goblin
    .getState()
    .get(`sessions.${token}`)
    .toJS();
  const channel = new WebSocketChannel(socket);
  quest.goblin.setX(`channel@${desktopId}`, channel);

  const carnotzetId = `carnotzet@${desktopId}`;
  yield quest.createFor('carnotzet', carnotzetId, carnotzetId, {
    id: carnotzetId,
    config: {feed: desktopId},
  });

  yield quest.me.subscribe({desktopId});

  //quest.cmd('warehouse.resend', {feed: desktopId});

  channel.sendAction({
    type: 'COMMANDS_REGISTRY',
    commands: quest.resp.getCommandsRegistry(),
  });

  socket.on('message', function(data) {
    data = JSON.parse(data);
    switch (data.type) {
      case 'QUEST': {
        onQuest(quest, null, data.data);
        break;
      }
    }
  });

  socket.on('close', function() {
    quest.release(carnotzetId);
    const unsub = quest.goblin.getX(`subs@${desktopId}`);
    unsub && unsub();
  });

  socket.on('error', function() {
    quest.release(carnotzetId);
    const unsub = quest.goblin.getX(`subs@${desktopId}`);
    unsub && unsub();
  });
  quest.cmd(`${onConnect.goblin}.${onConnect.quest}`, {
    id: onConnect.goblinId,
    labId: carnotzetId,
    desktopId,
    sessionInfo,
  });
});

Goblin.registerQuest(goblinName, 'subscribe', function(quest, desktopId) {
  const subs = [
    quest.sub(`*::warehouse.${desktopId}.changed`, (err, msg) => {
      quest.goblin.getX(`channel@${desktopId}`).sendBackendState(msg.data);
    }),

    quest.sub(`${desktopId}.nav.requested`, (err, msg) => {
      quest.me.nav({desktopId, route: msg.data.route});
    }),

    quest.sub(`${desktopId}.dispatch.requested`, (err, msg) => {
      quest.me.dispatch({desktopId, action: msg.data.action});
    }),
  ];

  quest.goblin.setX(`subs@${desktopId}`, () => {
    subs.forEach(unsub => unsub());
  });
});

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
