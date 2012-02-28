/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var Checkpoint = require('./checkpoint');
var EntryQueue = require('./entryQueue');
var EventEmitter = require('events').EventEmitter;

var bunyan = require('bunyan');
var common = require('./common');
var ldapjs = require('ldapjs');
var poolModule = require('generic-pool');
var util = require('util');

var ALL_CHANGES_CTRL = new ldapjs.PersistentSearchControl({
  type: '2.16.840.1.113730.3.4.3',
  value: {
    changeTypes: 15,
    changesOnly: false,
    returnECs: true
  }
});


/**
 * This object contains all of the context neccessary for a local client to
 * replicate against a remote URL. An 'init' even is emmited on initialization
 * completion.
 * @constructor
 * @this {ReplContext}
 * @param {object} options the set of args to instantiate this object.
 */
function ReplContext(options) {
  /**
   * The checkpoint object, see checkpoint.js
   */
  this.checkpoint = null;

  /**
   * The entryqueue object, used to hold changelogs. see entryQueue.js
   */
  this.entryQueue = null;

  /**
   * The local LDAP client.
   */
  this.localPool = null;

  /**
   * The logger.
   */
  this.log = null;

  /**
   * The remote LDAP client used to connect to the master LDAP server.
   */
  this.remotePool = null;

  /**
   * The remote replicated LDAP url.
   */
  this.url = null;

  /**
   * The local dn where the replicated entires are stored
   */
  this.replSuffix = null;

  /**
   * The url used by the checkpoint, this can be the same as the localUrl.
   */
  this.checkpointUrl = null;

  var self = this;
  EventEmitter.call(this);

  if (typeof(options) !== 'object') {
    throw new TypeError('options (object) required');
  }

  if (typeof(options.log) !== 'object') {
    throw new TypeError('options.log (object) required');
  }
  this.log = options.log;
  if (typeof(options.url) !== 'string') {
    throw new TypeError('options.url (string) required');
  }
  if (!options.remoteClientCfg) {
    options.remoteClientCfg = {
      url: options.url,
      log: options.log
    };
  } else {
    if (typeof(options.remoteClientCfg) !== 'object') {
      throw new TypeError('options.remoteClientCfg must be an object');
    } else {
      options.remoteClientCfg.log = options.log;
      options.remoteClientCfg.url = options.url;
    }
  }
  if (typeof(options.localUrl) !== 'string') {
    throw new TypeError('options.localUrl (string) required');
  }
  if (!options.checkpointUrl) {
    this.checkpointUrl = options.localUrl;
  } else {
    this.checkpointUrl = options.checkpointUrl;
  }
  if (!options.localClientCfg) {
    options.localClientCfg = {
      url: options.localUrl,
      log: options.log
    };
  } else {
    if (typeof(options.localClientCfg) !== 'object') {
      throw new TypeError('options.localClientCfg must be an object');
    } else {
      options.localClientCfg.log = options.log;
      options.localClientCfg.url = options.localUrl;
    }
  }
  if (typeof(options.checkpointDn) !== 'string') {
    throw new TypeError('options.checkpointDn (string) required');
  }
  if (typeof(options.replSuffix) !== 'string') {
    throw new TypeError('options.replSuffix (string required');
  }
  if (!options.localPoolCfg) {
    options.localPoolCfg = {
      max: 10,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      log: this.log
    };
  } else {
    if (options.localPoolCfg && typeof(options.localPoolCfg) !== 'object') {
      throw new TypeError('options.localPoolCfg must be an object');
    }
  }
  if (!options.remotePoolCfg) {
    options.remotePoolCfg = {
      max: 10,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      log: this.log
    };
  } else {
    if (options.remotePoolCfg && typeof(options.remotePoolCfg) !== 'object') {
      throw new TypeError('options.remotePoolCfg must be an object');
    }
  }

  this.url = ldapjs.url.parse(options.url, true);
  this.localUrl = ldapjs.url.parse(options.localUrl, true);
  this.replSuffix = options.replSuffix;
  this.log.debug('remote url', this.url);
  this.log.debug('remote DN', this.url.DN.rdns.toString());
  this.checkpoint = new Checkpoint();
  this.entryQueue = new EntryQueue();

  var poolCfg = options.poolCfg;
  if (!options.poolCfg) {
    poolCfg = {
      max: 10,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      log: this.log
    };
  }
  this.log.info('initializing replication components');

  initializeSubComponents(this, options);

}

util.inherits(ReplContext, EventEmitter);
module.exports = ReplContext;

/**
 * Initialization happens serially in the following manner:
 * 1) init the local client
 * 2) init the remote client
 * 3) init the checkpoint
 * 4) init the entry queue
 * 5) start the remotepersistent search
 * 6) emit an init event
 */
function initializeSubComponents(self, options) {
  self.log.debug('connection to local ldap with cfg', options.localClientCfg);
  self.localPool = poolModule.Pool({
    name: 'localPool',
    create: function(callback) {
      self.log.debug('creating client pool');
      var client = ldapjs.createClient(options.localClientCfg);

      client.on('error', function(err) {
        self.log.fatal('local client error', err);
        process.exit(1);
      });

      client.once('connect', function(id) {
        self.log.debug('client connected');
        var auth = self.localUrl.auth;
        // bind if there's auth info in the url
        if (auth) {
          common.bindClient(auth, client, self.log, function(err) {
              if (err) {
                self.log.fatal('unable to bind to local client', err);
                process.exit(1);
              } else {
                callback(null, client);
              }
          });
        } else {
          callback(null, client);
        }
      });
    },
    destroy: function(client) {
      self.log.debug('destroying client pool');
      client.unbind();
    },
    max: options.localPoolCfg.max,
    idleTimeoutMillis: options.localPoolCfg.idleTimeoutMillis,
    reapIntervalMillis: options.localPoolCfg.reapIntervalMillis,
    log: options.localPoolCfg.log
  });

  // acquire to start the connection to the server
  self.localPool.acquire(function(err, client) {
    if (err) {
      self.log.fatal('unable to acquire client from pool', err);
      process.exit(1);
    }
    self.localPool.release(client);
    return initRemoteClient();
  });

  function initRemoteClient() {
    self.log.debug('creating remote client', options.remoteClientCfg);
    self.remotePool = poolModule.Pool({
      name: 'remotePool',
      create: function(callback) {
        var remoteClient = ldapjs.createClient(options.remoteClientCfg);

        remoteClient.once('connect', function(err) {
          self.log.debug('remote client connected');
          // add binding if there's a username/password on the url
          if (self.url.auth) {
            common.bindClient(self.url.auth, remoteClient, self.log,
                              function(err) {
              if (err) {
                self.log.fatal('unable to bind to remote client', err);
                process.exit(1);
              }
              callback(null, remoteClient);

            });
          } else {
            callback(null, remoteClient);
          }
        });
      },
      destroy: function(client) {
        self.log.debug('destroying client pool');
        client.unbind();
      },
      max: options.remotePoolCfg.max,
      idleTimeoutMillis: options.remotePoolCfg.idleTimeoutMillis,
      reapIntervalMillis: options.remotePoolCfg.reapIntervalMillis,
      log: options.remotePoolCfg.log
    });

    // acquire to start the connection to the server
    self.remotePool.acquire(function(err, client) {
      if (err) {
        self.log.fatal('unable to acquire client from pool', err);
        process.exit(1);
      }
      self.remotePool.release(client);
      return initCheckpoint();
    });
  }

  var filter;
  function initCheckpoint() {
    self.log.debug('creating checkpoint');
    self.checkpoint.once('init', function(changenumber) {
      self.log.debug('checkpointed initialized');
      filter = '(changenumber>=' + changenumber + ')';
      return initEntryQueue();
    });

    self.log.debug('options.localUrl', options.localUrl);
    self.checkpoint.init({
      url: self.checkpointUrl,
      dn: options.checkpointDn,
      localUrl: options.localUrl,
      log: options.log,
      localClientCfg: options.localClientCfg
    });
  }

  function initEntryQueue() {
    self.log.debug('creating entry queue');
    self.entryQueue.once('init', function() {
      self.log.debug('entryqueue initialized');
      return startPSearch();
    });

    self.entryQueue.init({
      url: options.url,
      log: options.log,
      replContext: self
    });
  }

  function startPSearch() {
    self.log.debug('starting persistent search');
    self.remotePool.acquire(function(err, client) {
      if (err) {
        self.log.fatal('unable to acquire client from pool', err);
        process.exit(1);
      }
      client.search('cn=changelog',
                                {filter: filter, scope: 'sub'},
                                ALL_CHANGES_CTRL,
                                changelogHandler);
    });
  }

  function changelogHandler(err, res) {
    if (err) {
      self.log.fatal('unable to instantiate persistent search for changelog',
                      err);
      process.exit(1);
    }

    res.on('searchEntry', function(entry) {
      self.log.debug('changelog entry %j', entry.object);
      self.entryQueue.push(entry);
    });

    // TODO: error handling and retries
    res.on('error', function(err) {
      self.log.fatal('unable to instantiate persistent search for changelog',
                      err);
      process.exit(1);
    });

    self.log.info('fully initialized, sending init event');
    self.emit('init', self);
  }
}
