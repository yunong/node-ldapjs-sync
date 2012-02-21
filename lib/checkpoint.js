/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var common  = require('./common');
var emitter = require('events').EventEmitter;
var ldapjs  = require('ldapjs');
var log4js  = require('log4js');
var sys     = require('sys');

var ENTRY = {
  objectclass: 'changenumber',
  value: 0
};

var SEARCH_OPTIONS = {
  scope: 'base',
  filter: '(objectclass=changenumber)'
};

/**
 * the remote url
 */
Checkpoint.prototype.url = null;

/**
 * The logger
 */
Checkpoint.prototype.log = null;

/**
 * the client where the checkpoint is stored
 */
Checkpoint.prototype.client = null;

/**
 * the checkpoint is stored under this DN, which is of the format: uid=md5(url)
 */
Checkpoint.prototype.dn = null;

/**
 * The checkpoint Object used to store the latest consumed change numbers from
 * the remote url. The checkpoint is stored in LDAP, and represents the last
 * changelog number replicated from the remote LDAP server. Emits an 'init'
 * event when instantiated.
 *
 * Create this object as follows:
 *
 *  var checkpoint = new Checkpoint();
 *  checkpoint.once('init', function(cn) {
 *    console.log('checkpoint has been initialized with changnumber', cn);
 *  })
 *  checkpoint.init();
 *
 * Note this object is created asynchronously by invoking init. Calling new
 * merely gives consumer a handle to the object. The handle allows consumers
 * to listen for the init event.
 */
function Checkpoint() {
  emitter.call(this);
}

// inherit emitter
sys.inherits(Checkpoint, emitter);
module.exports = Checkpoint;

/**
 * Initializes the checkpoint object, and sets the checkpoint to 0 if no
 * checkpoint exists.
 * @param options : the set of options for the checkpoint {
 *   dn: the dn under which the checkpoint is stored,
 *   url: the remote url that's replicated
 *   localUrl: the local url where the checkpoint is stored
 *   localClientCfg(optional): the config for the local ldap client
 * }
 */
Checkpoint.prototype.init = function(options) {
  var self = this;
  if (!options || typeof(options) !== 'object') {
    throw new TypeError('options (object) required');
  }
  if (!options.dn || typeof(options.dn) !== 'string') {
    throw new TypeError('options.dn (string) required');
  }
  if (!options.url || typeof(options.url) !== 'string') {
    throw new TypeError('options.url (string) required');
  }
  if (!options.localUrl || typeof(options.localUrl) !== 'string') {
    throw new TypeError('options.localUrl (string) required');
  }
  if (options.log4js) {
    this.log = options.log4js.getLogger('checkpoint.js');
  } else {
    this.log = log4js.getLogger('checkpoint.js');
  }
  if (!options.localClientCfg || typeof(options.localClientCfg) !== 'object') {
    throw new TypeError('options.localClientCfg (object) required');
  }

  self.log.debug('initializing checkpoint %j', options);

  var urlHash = require("crypto").createHash('md5').update(options.url).
                digest('hex');
  this.dn = 'uid=' + urlHash + ', ' + options.dn;

  this.localUrl = ldapjs.url.parse(options.localUrl, true);

  self.log.debug('creating client');
  this.client = ldapjs.createClient(options.localClientCfg);

  this.client.once('connect', function(id) {
    self.log.debug('client connected');
    var auth = self.localUrl.auth;
    // bind if there's auth info in the url
    if (auth) {
      return common.bindClient(auth, self.client, self.log, function(err) {
          if (err) {
            self.log.fatal('unable to bind to local client', err);
            process.exit(1);
          } else {
            return initCheckpoint();
          }
      });
    } else {
      return initCheckpoint();
    }
  });

  function initCheckpoint() {
    self.log.debug('initializing checkpoint %s', self.dn);
    // init checkpoint
    self.getCheckpoint(function(changenumber) {
      self.log.info('checkpoint %s initialized to %s', self.dn,
                    changenumber);
      self.emit('init', changenumber);
    });
  }
};

/**
 * Gets the current checkpoint
 * @param callback : function(changenumber)
 */
Checkpoint.prototype.getCheckpoint = function(callback) {
  if (!callback && typeof(callback) !== 'function') {
    throw new TypeError('callback (function) required');
  }

  var self = this;
  self.log.debug('getting checkpoint %s', this.dn);
  this.client.search(this.dn, SEARCH_OPTIONS, function(err, res) {
    if (err) {
      console.log('your mom');
      self.log.fatal('unable to fetch checkpoint from dn %s, with error %s',
                     this.dn, err);
      process.exit(1);
    }

    res.on('searchEntry', function(entry) {
      var changenumber = entry.object.value;
      self.log.debug('got changenumber %s for dn %s',
                     changenumber, self.dn);
      // parse int as ldap returns everything as strings. '9' is > '11', cool?
      changenumber = parseInt(changenumber, 10);
      return callback(changenumber);
    });

    res.on('error', function(err) {
      // if the checkpoint DNE, set it to 0
      if (err.code === 32) {
        self.log.debug('checkpoint %s dne, initializing to 0', self.dn);
        self.client.add(self.dn, ENTRY, function(err, res) {
          if (err) {
            self.log.fatal('unable to init checkpoint %s, with error %s',
                           self.dn, err);
          }

          return callback(0);
        });
      } else {
        self.log.fatal('unable to fetch checkpoint from dn %s, with error %s',
                       self.dn, err);
        process.exit(1);
      }
    });
  });
};

/**
 * Sets the current checkpoint
 * @param changenumber : the changnumber to set the checkpoint to.
 * @param callback : function(err, res)
 */
Checkpoint.prototype.setCheckpoint = function(changenumber, callback) {
  var self = this;
  self.log.debug('setting changenumber %s for dn %s', changenumber, this.dn);
  // Assume the dn has been initialized, so modify the entry

  var change = new ldapjs.Change({
    type: 'replace',
    modification: new ldapjs.Attribute({
      type: 'value',
      vals: changenumber
    })
  });

  this.client.modify(this.dn, change, function(err, res) {
    if (err) {
      self.log.error('unable to set checkpoint %s to changenumber %s',
                     self.dn, changenumber, err);
      return callback(err);
    }

    self.log.debug('set checkpoint %s to %s', self.dn, changenumber);
    return callback(err, res);
  });
};

