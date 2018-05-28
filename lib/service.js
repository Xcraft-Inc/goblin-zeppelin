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
const logicHandlers = {};

const onQuest = (quest, evt, action) => {
  const _action = helpers.fromXcraftJSON(action)[0];
  quest.cmd(_action.cmd, _action.data);
};

Goblin.registerQuest(goblinName, 'init', function(
  quest,
  mandate,
  feeds,
  port = 8000
) {
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({port});
  wss.on('connection', (socket, req) => {
    quest.me.onConnection({mandate, socket, req, feeds});
  });
});

Goblin.registerQuest(goblinName, 'onConnection', function*(
  quest,
  socket,
  req,
  mandate,
  feeds
) {
  //GET SESSION FROM REQUESTED URL
  const sessionInfo = req.url.split('/');
  const token = sessionInfo[1];
  const desktopId = `desktop@${mandate}@${token}`;
  quest.goblin.setX(`channel@${desktopId}`, new WebSocketChannel(socket));
  console.log('session', desktopId);

  const carnotzetId = `carnotzet@${desktopId}`;
  quest.defer(() => quest.release(carnotzetId));
  yield quest.createFor('carnotzet', carnotzetId, carnotzetId, {
    id: carnotzetId,
    config: {feed: carnotzetId},
  });
  yield quest.me.feedSub({desktopId, feeds});
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
    const unsub = quest.goblin.getX(`subs@${desktopId}`);
    unsub && unsub();
  });

  socket.on('error', function() {
    const unsub = quest.goblin.getX(`subs@${desktopId}`);
    unsub && unsub();
  });
});

Goblin.registerQuest(goblinName, 'feed-sub', function*(
  quest,
  desktopId,
  feeds
) {
  //TODO: unsub onClose
  quest.goblin.setX(
    `subs@${desktopId}`,
    quest.sub(`*::warehouse.${desktopId}.changed`, (err, msg) => {
      quest.goblin.getX(`channel@${desktopId}`).sendBackendState(msg.data);
    })
  );

  yield quest.cmd('warehouse.subscribe', {
    feed: desktopId,
    branches: feeds,
  });
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
