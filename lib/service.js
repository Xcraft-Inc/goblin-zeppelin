'use strict';

const path = require ('path');
const goblinName = path.basename (module.parent.filename, '.js');

const Goblin = require ('xcraft-core-goblin');

// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  create: state => {
    return state;
  },
};

Goblin.registerQuest (goblinName, 'destination.create', function (
  quest,
  id,
  name,
  landing
) {
  quest.cmd (landing, {url: 'http://localhost:4000'});
});

Goblin.registerQuest (goblinName, 'destination.delete', function (
  quest,
  id
) {});

Goblin.registerQuest (goblinName, 'open', function (
  quest,
  passport,
  flight
) {});

Goblin.registerQuest (goblinName, 'leave', function (
  quest,
  passport,
  flight
) {});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure (goblinName, logicState, logicHandlers);
