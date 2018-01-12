
const Clutter = imports.gi.Clutter;
const GDesktopEnums = imports.gi.GDesktopEnums;
const Lang = imports.lang
const Magnifier = imports.ui.magnifier;
const Main = imports.ui.main
const Meta = imports.gi.Meta
const Params = imports.misc.params;
const Shell = imports.gi.Shell

// var ZoomerPopup = new Lang.Class({
//   Name: 'ZoomerPopup',
//
//   _init: function(items) {
//
//     this.actor = new Shell.GenericContainer({ style_class: 'switcher-popup',
//     reactive: true,
//     visible: false });
//     this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
//     this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
//     Main.uiGroup.add_actor(this.actor);
//
//     this._haveModal = false;
//     this._modifierMask = 0;
//   },
//
//   _getPreferredWidth: function(actor, forHeight, alloc) {
//     let primary = Main.layoutManager.primaryMonitor;
//
//     alloc.min_size = primary.width;
//     alloc.natural_size = primary.width;
//   },
//
//   _getPreferredHeight: function(actor, forWidth, alloc) {
//     let primary = Main.layoutManager.primaryMonitor;
//
//     alloc.min_size = primary.height;
//     alloc.natural_size = primary.height;
//   },
//
//   show: function(backward, binding, mask) {
//     log( "show zoomer actor..." )
//     if (!Main.pushModal(this.actor)) {
//       return false;
//       // Probably someone else has a pointer grab, try again with keyboard only
//       // if (!Main.pushModal(this.actor, { options: Meta.ModalOptions.POINTER_ALREADY_GRABBED })) {
//       //     return false;
//       // }
//     }
//     this._haveModal = true;
//     this._modifierMask = primaryModifier(mask);
//     log( "have modal with modifier mask = " + this._modifierMask )
//
//     this.actor.connect('key-press-event', Lang.bind(this, this._keyPressEvent));
//     this.actor.connect('key-release-event', Lang.bind(this, this._keyReleaseEvent));
//     this.actor.connect('scroll-event', Lang.bind(this, this._scrollEvent));
//
//     // There's a race condition; if the user released Alt before
//     // we got the grab, then we won't be notified. (See
//     // https://bugzilla.gnome.org/show_bug.cgi?id=596695 for
//     // details.) So we check now. (Have to do this after updating
//     // selection.)
//     // if (this._modifierMask) {
//     //     let [x, y, mods] = global.get_pointer();
//     //     if (!(mods & this._modifierMask)) {
//     //         this._finish(global.get_current_time());
//     //         return false;
//     //     }
//     // } else {
//     //     this._resetNoModsTimeout();
//     // }
//
//     return true;
//   },
//
//   _keyReleaseEvent: function(actor, event) {
//     if (this._modifierMask) {
//       let [x, y, mods] = global.get_pointer();
//       let state = mods & this._modifierMask;
//
//       if (state == 0)
//       this._finish(event.get_time());
//     } else {
//       this._resetNoModsTimeout();
//     }
//
//     return Clutter.EVENT_STOP;
//   },
//
//   _scrollHandler: function(direction) {
//     if (direction == Clutter.ScrollDirection.UP)
//     this._select(this._previous());
//     else if (direction == Clutter.ScrollDirection.DOWN)
//     this._select(this._next());
//   },
//
//   _scrollEvent: function(actor, event) {
//     log( "scroll event received!" )
//     this._scrollHandler(event.get_scroll_direction());
//     return Clutter.EVENT_STOP;
//   },
//
//   _popModal: function() {
//     if (this._haveModal) {
//       Main.popModal(this.actor);
//       this._haveModal = false;
//     }
//   },
//
//   destroy: function() {
//     this._popModal();
//   },
//
//   _finish: function(timestamp) {
//     this.destroy();
//   },
// });
function log(message) {
  global.log("desktopzoom: " + message)
}

var KeyManager = new Lang.Class({
  Name: 'MyKeyManager',

  _init: function() {
    this.grabbers = new Map()
    log("keymanager init...")
    global.display.connect(
      'accelerator-activated',
      Lang.bind(this, function(display, action, deviceId, timestamp){
        log('Accelerator Activated: display=' + display + ' action=' + action + ' deviceId=' + deviceId + ' timestamp=' + timestamp);
        this._onAccelerator(action)
      }))
    },

    listenFor: function(accelerator, callback){
      log('Trying to listen for hot key accelerator=' + accelerator);
      let action = global.display.grab_accelerator(accelerator);

      if(action == Meta.KeyBindingAction.NONE) {
        log('Unable to grab accelerator binding=' + accelerator);
      } else {
        log('Grabbed accelerator action=' + action);
        let name = Meta.external_binding_name_for_action(action);
        log('Received binding name for action name=' + name + ' action=' + action);
        Main.wm.allowKeybinding(name, Shell.ActionMode.ALL);

        this.grabbers.set(action, {
          name: name,
          accelerator: accelerator,
          callback: callback
        });
      }
    },

    _onAccelerator: function(action) {
      let grabber = this.grabbers.get(action);

      if(grabber) {
        this.grabbers.get(action).callback();
      } else {
        log('No listeners action=' + action);
      }
    }
  })

  function mod(a, b) {
    return (a + b) % b;
  }

  function primaryModifier(mask) {
    if (mask == 0)
    return 0;

    let primary = 1;
    while (mask > 1) {
      mask >>= 1;
      primary <<= 1;
    }
    return primary;
  }

  // Handles the interface to the 'system' magnifier.
  var DesktopLens = new Lang.Class({
      Name: "DesktopLens"

      _init: function(minMag, maxMag) {
        this._minMag = minMag;
        this._maxMag = maxMag;
        this._settings = new Gio.Settings({ schema_id: MAGNIFIER_SCHEMA });
        this._initMagnifier();
        this._changeId = null;
      },

      _initMagnifier: function() {
        this._lens = Main.magnifier;

        // listen for other parties that changes the magnifier state.
        if(this._changeId) {
          this._lens.disconnect(this._changeId);
        }
        this._lens.setActive(true);
        this._changeId = this._lens.connect(
          'active-changed',Lang.bind(this,this._activeChanged)
        );

        // We only work with the first zoom region...
        let zoomRegions = this._lens.getZoomRegions();
        if(zoomRegions.length) {
          this._zoomRegion = zoomRegions[0];
          this._zoomRegion.setFullScreenMode();
          this._zoomRegion.setFocusTrackingMode(
            GDesktopEnums.MagnifierFocusTrackingMode.NONE
          );
          this._zoomRegion.setCaretTrackingMode(
            GDesktopEnums.MagnifierCaretTrackingMode.NONE
          );
          this._zoomRegion.setLensMode(true);
        } else {
          this._zoomRegion = null;
        }

        // clamp magnification to allowed interval
        let mag = getMagFactor();
        if(mag < this._minMag) {
          setMagFactor(this._minMag);
        }
        else if(mag > this._maxMag) {
          setMagFactor(this._maxMag);
        }
      },

      getMagFactor: function() {
        if(this._zoomRegion) {
          [xMag, yMag] = this_._zoomRegion.getMagFactor();
          return xMag;
        }
        return 1;
      },

      setMagFactor: function(mag) {
        if(this._zoomRegion && mag >= this._minMag && mag <= this._maxMag) {
          // Mag factor is accurate to two decimal places.
          let fixed = parseFloat(mag.toFixed(2));
          this._zoomRegion.setMagFactor(fixed,fixed);
        }
      },

      _activeChanged: function(activate) {
        if(!activate) {
          _initMagnifier();
        }
      }
  });

  var DesktopZoomer = new Lang.Class({
    Name: "DesktopZoomer",

    _init: function() {
      log("init zoomer");
      this._hasModal = false;
      this._scrollId = null;
      this._keyReleaseId = null;
      this._lens = new DesktopLens(0.5,4.0);
      this._factor = this.lens.getMagFactor();
    },

    startZoomSession: function() {
      log("startZoomSession() called");
      if(this._hasModal)
        return;

      log("invoking begin_modal()...");
      var params = Params.parse(params, { timestamp: global.get_current_time(),
                                          options: 0 });
      if (!global.begin_modal(params.timestamp, params.options)) {
          log('invocation of begin_modal failed');
          return;
      }

      Meta.disable_unredirect_for_screen(global.screen);
      this._hasModal = true;
      this._scrollId = global.stage.connect('scroll-event', Lang.bind(this, this._scrollEvent));
      this._keyPressId = global.stage.connect('key-press-event', Lang.bind(this, this._keyPressEvent));
      this._keyReleaseId = global.stage.connect('key-release-event', Lang.bind(this, this._keyReleaseEvent));
    },

    stopZoomSession: function() {
      log("stopZoomSession() called!");
      this._endModal();
    },

    destroy: function() {
      log("destroy() called!");
      this._endModal();
    },

    _endModal: function() {
      log("_endModal() called!");
      if (this._hasModal) {
        log("disabling modal mode...");
        if(this._scrollId)
          global.stage.disconnect(this._scrollId);
        if(this._keyReleaseId)
          global.stage.disconnect(this._keyReleaseId);
        global.end_modal(global.get_current_time());
        Meta.enable_unredirect_for_screen(global.screen);
        this._scrollId = null;
        this._keyReleaseId = null;
        this._hasModal = false;
      }
    },

    _scrollEvent: function(actor, event) {
      if(event.has_shift_modifier()) {
        this._scrollHandler(event);
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    },

    _scrollHandler: function(event) {
      let direction = event.get_scroll_direction()
      let scrollDelta = 0.1;
      if(direction == Clutter.ScrollDirection.SMOOTH) {
        // Don't care about the 'smoothness', just use up/down
        let [dx, dy] = event.get_scroll_delta();
        scrollDelta = (dy < 0 ? 0.02 : -0.02);
      } else if(direction == Clutter.ScrollDirection.UP) {
        scrollDelta = 0.15;
      } else if(direction == Clutter.ScrollDirection.DOWN) {
        scrollDelta = -0.15;
      }
      this._factor = this._factor * (1 + scrollDelta);
      this._lens.setMagFactor(this._factor);
    },

    _keyReleaseEvent: function(actor, event) {
      log("_keyReleaseEvent() called");
      log("Key released with symbol: " + event.get_key_symbol());
      this._endModal();
      return Clutter.EVENT_STOP;
    },

    _keyPressEvent: function(actor, event) {
      log("_keyPressEvent() called");
      log("Key press with symbol: " + event.get_key_symbol());
      return Clutter.EVENT_PROPAGATE;
    }
  });

  let desktopZoomer, keyManager;

  function init() {
    log("extension init() called");
  }

  function enable() {
    log("extension enable() called");
    if(!keyManager) {
      desktopZoomer = new DesktopZoomer();
      keyManager = new KeyManager();
      log("initializing...");
      keyManager.listenFor("<shift>a", function(){
        desktopZoomer.startZoomSession();
     });
    }
  }

  function disable() {
    log("extension disable() called");
    keyManager = null;
    desktopZoomer.destroy();
    desktopZoomer = null;
  }
