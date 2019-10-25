import {
  assign,
  every,
  forEach,
  isArray,
  isDefined,
  isFunction,
  some
} from 'min-dash';

import {
  delegate as domDelegate,
  event as domEvent,
  attr as domAttr,
  query as domQuery,
  classes as domClasses,
  domify as domify
} from 'min-dom';

import { getBBox } from '../../util/Elements';

var entrySelector = '.entry';

var CONTEXT_PAD_PADDING = 12;


/**
 * A context pad that displays element specific, contextual actions next
 * to a diagram element.
 *
 * @param {Canvas} canvas
 * @param {Object} config
 * @param {Boolean|Object} [config.scale={ min: 1.0, max: 1.5 }]
 * @param {Number} [config.scale.min]
 * @param {Number} [config.scale.max]
 * @param {EventBus} eventBus
 * @param {Overlays} overlays
 * @param {Selection} selection
 */
export default function ContextPad(canvas, config, eventBus, overlays, selection) {
  this._providers = [];

  this._canvas = canvas;
  this._eventBus = eventBus;
  this._overlays = overlays;
  this._selection = selection;

  var scale = isDefined(config && config.scale) ? config.scale : {
    min: 1,
    max: 1.5
  };

  this._overlaysConfig = {
    scale: scale
  };

  this._current = null;

  this._init();
}

ContextPad.$inject = [
  'canvas',
  'config.contextPad',
  'eventBus',
  'overlays',
  'selection'
];


/**
 * Registers events needed for interaction with other components.
 */
ContextPad.prototype._init = function() {
  var self = this;

  this._eventBus.on('selection.changed', function(event) {

    var selection = event.newSelection;

    if (selection.length) {
      self.open(selection);
    } else {
      self.close();
    }
  });

  this._eventBus.on('elements.delete', function(event) {
    var elements = event.elements;

    forEach(elements, function(event) {
      if (self.isOpen(event)) {
        self.close();
      }
    });
  });

  this._eventBus.on('elements.changed', function(event) {
    var elements = event.elements,
        current = self._current;

    if (!current) {
      return;
    }

    if (some(elements, function(element) {
      return includes(current.elements, element);
    })) {
      self.open(current.elements, true);
    }
  });
};


/**
 * Register context pad provider.
 *
 * @param  {ContextPadProvider} provider
 */
ContextPad.prototype.registerProvider = function(provider) {
  this._providers.push(provider);
};


/**
 * Get context pad entries for given elements.
 *
 * @param {Array<djs.element.Base>} elements
 *
 * @return {Array<ContextPadEntryDescriptor>} list of entries
 */
ContextPad.prototype.getEntries = function(elements) {
  var entries = {};

  // loop through all providers and their entries.
  // group entries by id so that overriding an entry is possible
  forEach(this._providers, function(provider) {
    var e = provider.getContextPadEntries(elements);

    forEach(e, function(entry, id) {
      entries[id] = entry;
    });
  });

  return entries;
};


/**
 * Trigger context pad action.
 *
 * @param  {String} action
 * @param  {Event} event
 * @param  {Boolean} [autoActivate=false]
 */
ContextPad.prototype.trigger = function(action, event, autoActivate) {

  var elements = this._current.elements,
      entries = this._current.entries,
      entry,
      handler,
      originalEvent,
      button = event.delegateTarget || event.target;

  if (!button) {
    return event.preventDefault();
  }

  entry = entries[domAttr(button, 'data-action')];
  handler = entry.action;

  originalEvent = event.originalEvent || event;

  // simple action (via callback function)
  if (isFunction(handler)) {
    if (action === 'click') {
      return handler(originalEvent, elements, autoActivate);
    }
  } else {
    if (handler[action]) {
      return handler[action](originalEvent, elements, autoActivate);
    }
  }

  // silence other actions
  event.preventDefault();
};


/**
 * Open the context pad for given elements.
 *
 * @param {Array<djs.model.Base>} elements
 * @param {boolean} [force] - Force re-opening context pad.
 */
ContextPad.prototype.open = function(elements, force) {
  if (!force && this.isOpen(elements)) {
    return;
  }

  this.close();

  this._updateAndOpen(elements);
};


ContextPad.prototype._updateAndOpen = function(elements) {
  var entries = this.getEntries(elements),
      pad = this.getPad(elements),
      html = pad.html;

  forEach(entries, function(entry, id) {
    var grouping = entry.group || 'default',
        control = domify(entry.html || '<div class="entry" draggable="true"></div>'),
        container;

    domAttr(control, 'data-action', id);

    container = domQuery('[data-group=' + grouping + ']', html);
    if (!container) {
      container = domify('<div class="group" data-group="' + grouping + '"></div>');
      html.appendChild(container);
    }

    container.appendChild(control);

    if (entry.className) {
      addClasses(control, entry.className);
    }

    if (entry.title) {
      domAttr(control, 'title', entry.title);
    }

    if (entry.imageUrl) {
      control.appendChild(domify('<img src="' + entry.imageUrl + '">'));
    }
  });

  domClasses(html).add('open');

  this._current = {
    elements: elements,
    entries: entries,
    pad: pad
  };

  this._eventBus.fire('contextPad.open', { current: this._current });
};


ContextPad.prototype.getPad = function(elements) {
  if (this.isOpen()) {
    return this._current.pad;
  }

  var self = this;

  var overlays = this._overlays;

  var html = domify('<div class="djs-context-pad"></div>');

  var overlaysConfig = assign({
    html: html,
  }, this._overlaysConfig, this._getPosition());

  domDelegate.bind(html, entrySelector, 'click', function(event) {
    self.trigger('click', event);
  });

  domDelegate.bind(html, entrySelector, 'dragstart', function(event) {
    self.trigger('dragstart', event);
  });

  // stop propagation of mouse events
  domEvent.bind(html, 'mousedown', function(event) {
    event.stopPropagation();
  });

  this._overlayId = overlays.add('context-pad', overlaysConfig);

  var pad = overlays.get(this._overlayId);

  this._eventBus.fire('contextPad.create', { elements: elements, pad: pad });

  return pad;
};


/**
 * Close the context pad
 */
ContextPad.prototype.close = function() {
  if (!this.isOpen()) {
    return;
  }

  this._overlays.remove(this._overlayId);

  this._overlayId = null;

  this._eventBus.fire('contextPad.close', { current: this._current });

  this._current = null;
};

/**
 * Check if pad is open.
 *
 * @param {Array<djs.model.Base>} [elements]
 * @return {Boolean}
 */
ContextPad.prototype.isOpen = function(elements) {
  var current = this._current;

  if (!current) {
    return false;
  }

  return !elements || elements.length === current.elements.length && every(elements, function(element) {
    return includes(current.elements, element);
  });
};


/**
 * Get contex pad position.
 */
ContextPad.prototype._getPosition = function() {
  var selection = this._selection.get();

  var bBox = getBBox(selection);

  return {
    position: {
      left: bBox.x + bBox.width + CONTEXT_PAD_PADDING,
      top: bBox.y - CONTEXT_PAD_PADDING / 2
    }
  };
};


// helpers //////////

function addClasses(element, classNames) {
  var classes = domClasses(element);

  classNames = isArray(classNames) ? classNames : classNames.split(/\s+/g);

  classNames.forEach(function(cls) {
    classes.add(cls);
  });
}

function includes(array, item) {
  return array.indexOf(item) !== -1;
}