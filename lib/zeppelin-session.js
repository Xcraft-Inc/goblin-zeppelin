'use strict';

const path = require('path');
const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');

const logicState = {
  id: null,
  locale: null,
};

const logicHandlers = {
  create: (state, action) => {
    return state.set('id', action.get('id'));
  },

  setLocale: (state, action) => {
    const locale = action.get('locale');
    return state.set('locale', locale);
  },
};

const quests = {
  create: function (quest, desktopId) {
    quest.do();
  },

  _findLocale: function* (quest, selectedLocale, acceptLanguage) {
    const nabuAPI = quest.getAPI('nabu');
    if (selectedLocale) {
      const localeName = yield nabuAPI.findBestLocale({locale: selectedLocale});
      if (localeName) {
        return localeName;
      }
    }

    if (acceptLanguage) {
      const acceptedlanguages = acceptLanguage.split(',').map((value) => {
        value = value.trim().toLowerCase();
        const [_, baseTag, variant, qualityStr] = value.match(
          /^([a-z0-9]+|\*)(?:-([a-z0-9]+))?[^;]*(?:;q=([0-9.]+))?$/
        );
        let quality = Number(qualityStr);
        if (isNaN(quality)) {
          quality = 1;
        }
        return {
          baseTag,
          variant,
          quality,
        };
      });

      const supportedAndAccepted = acceptedlanguages.sort(
        (a, b) => b.quality - a.quality
      );

      for (const lang of supportedAndAccepted) {
        const localeName = yield nabuAPI.findBestLocale({locale: lang.baseTag});
        if (localeName) {
          return localeName;
        }
      }
    }

    return yield nabuAPI.getFirstLocale();
  },

  setLocale: function* (quest, selectedLocale, acceptLanguage) {
    const locale = yield quest.me._findLocale({selectedLocale, acceptLanguage});
    quest.do({locale});
  },

  delete: function (quest) {},
};

// Register all quests
for (const questName in quests) {
  Goblin.registerQuest(goblinName, questName, quests[questName]);
}

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
