'use strict';

const path = require('path');
const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');
const {getLocaleLanguage} = require('goblin-nabu/lib/helpers.js');

const logicState = {
  id: null,
  locale: null,
  userLocale: null,
  theme: null,
  views: {},
  tips: {},
  splitters: {},
  dialogs: {},
  desktopClock: {},
  translatableTextField: {},
  lastColorsPicker: [],
  accessToEggsThemes: false,
  prototypeMode: false,
};

const logicHandlers = {
  'create': (state, action) => {
    return state.set('id', action.get('id'));
  },

  'setLocale': (state, action) => {
    const locale = action.get('locale');
    return state.set('locale', locale);
  },

  'set-tips': (state, action) => {
    const tipsId = action.get('tipsId');
    const tipsState = action.get('state');
    return state.set(`tips.${tipsId}`, tipsState);
  },

  'set-splitters': (state, action) => {
    const splitterId = action.get('splitterId');
    const splitterState = action.get('state');
    return state.set(`splitters.${splitterId}`, splitterState);
  },

  'set-dialogs': (state, action) => {
    const dialogId = action.get('dialogId');
    const dialogState = action.get('state');
    return state.set(`dialogs.${dialogId}`, dialogState);
  },

  'set-last-colors-picker': (state, action) => {
    const lastColors = action.get('state');
    return state.set('lastColorsPicker', lastColors);
  },

  'set-desktop-clock': (state, action) => {
    const theme = action.get('theme');
    const clockState = action.get('state');
    return state.set(`desktopClock.${theme}`, clockState);
  },

  'set-translatable-text-field': (state, action) => {
    const translatableState = action.get('state');
    return state.set('translatableTextField', translatableState);
  },

  'set-theme': (state, action) => {
    const theme = action.get('theme');
    return state.set('theme', theme);
  },

  'set-zoom': (state, action) => {
    const zoom = action.get('zoom');
    return state.set('zoom', zoom);
  },

  'set-view-columns-order': (state, action) => {
    const viewId = action.get('viewId');
    const columnIds = action.get('columnIds');
    const viewSettings = state.get(`views.${viewId}`);
    if (!viewSettings) {
      state = state.set(`views.${viewId}`, {
        widths: {},
        order: [],
        sorting: {},
      });
    }
    state = state.set(`views.${viewId}.order`, columnIds);
    return state;
  },

  'set-view-column-width': (state, action) => {
    const viewId = action.get('viewId');
    const columnId = action.get('columnId');
    const width = action.get('width');
    const viewSettings = state.get(`views.${viewId}`);
    if (!viewSettings) {
      state = state.set(`views.${viewId}`, {
        widths: {},
        order: [],
        sorting: {},
      });
    }
    state = state.set(`views.${viewId}.widths.${columnId}`, width);
    return state;
  },

  'set-view-column-sorting': (state, action) => {
    const viewId = action.get('viewId');
    const columnId = action.get('columnId');
    const direction = action.get('direction');
    const viewSettings = state.get(`views.${viewId}`);
    if (!viewSettings) {
      state = state.set(`views.${viewId}`, {
        widths: {},
        order: [],
        sorting: {},
      });
    }
    state = state.set(`views.${viewId}.sorting`, {columnId, direction});
    return state;
  },

  'reset-view-column': (state, action) => {
    const viewId = action.get('viewId');
    return state.del(`views.${viewId}`);
  },

  'set-access-to-eggs-themes': (state, action) => {
    const show = action.get('show');
    return state.set('accessToEggsThemes', show);
  },

  'toggle-prototype-mode': (state) => {
    const mode = state.get('prototypeMode');
    return state.set('prototypeMode', !mode);
  },
};

const quests = {
  'create': function (quest, desktopId) {
    quest.do();
  },

  '_findLocale': function* (quest, selectedLocale, acceptLanguage) {
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

  'setLocale': function* (quest, locale, selectedLocale, acceptLanguage) {
    locale = yield quest.me._findLocale({
      selectedLocale: locale || selectedLocale,
      acceptLanguage,
    });
    quest.do({locale});
  },

  'getLocale': function (quest) {
    const state = quest.goblin.getState();
    return state.get('locale');
  },

  'change-locale': function* (quest, locale) {
    yield quest.me.setLocale({selectedLocale: locale});
  },

  'getLanguage': function (quest) {
    const state = quest.goblin.getState();
    const locale = state.get('locale');
    return getLocaleLanguage(locale);
  },

  'set-tips': function (quest, tipsId, state) {
    quest.do({tipsId, state});
  },

  'set-splitters': function (quest, splitterId, state) {
    quest.do({splitterId, state});
  },

  'set-dialogs': function (quest, dialogId, state) {
    quest.do({dialogId, state});
  },

  'set-last-colors-picker': function (quest, state) {
    quest.do({state});
  },

  'set-desktop-clock': function (quest, theme, state) {
    quest.do({theme, state});
  },

  'set-translatable-text-field': function (quest, state) {
    quest.do({state});
  },

  'set-zoom': function (quest, zoom) {
    quest.do({zoom});
  },

  'get-zoom': function (quest) {
    return quest.goblin.getState().get('zoom');
  },

  'set-view-column-sorting': function (quest, viewId, columnId, direction) {
    quest.do({viewId, columnId, direction});
  },

  'set-view-column-width': function (quest, viewId, columnId, width) {
    quest.do({viewId, columnId, width});
  },

  'set-view-columns-order': function (quest, viewId, columnsIds) {
    quest.do({viewId, columnsIds});
  },

  'reset-view-column': function (quest, viewId) {
    quest.do();
  },

  'set-theme': function (quest, theme) {
    quest.do({theme});
  },

  'set-access-to-eggs-themes': function (quest, show) {
    quest.do({show});
  },

  'toggle-prototype-mode': function (quest) {
    quest.do();
  },

  'get-theme': function (quest) {
    return quest.goblin.getState().get('theme');
  },

  'delete': function (quest) {},
};

// Register all quests
for (const questName in quests) {
  Goblin.registerQuest(goblinName, questName, quests[questName]);
}

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
