'use strict';

const path = require('path');
const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');

const logicState = {
  id: null,
};

const logicHandlers = {
  create: (state, action) => {
    return state.set('id', action.get('id'));
  },
};

const quests = {
  create: function (quest, desktopId) {
    quest.do();
  },

  delete: function (quest) {},
};

// Register all quests
for (const questName in quests) {
  Goblin.registerQuest(goblinName, questName, quests[questName]);
}

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
