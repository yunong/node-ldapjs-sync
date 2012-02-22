/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var Checkpoint = require('./checkpoint');
var EntryQueue = require('./entryQueue');
var EventEmitter = require('events').EventEmitter;

var common = require('./common');
var ldapjs = require('ldapjs');
var log4js = require('log4js');
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
  this.localClient = null;

  /**
   * The logger.
   */
  this.log = null;

  /**
   * The log4js object.
   */
  this.log4js = null;

  /**
   * The remote LDAP client used to connect to the master LDAP server.
   */
  this.remoteClient = null;

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
  if (options.log4js && typeof(options.log4js) !== 'object') {
    throw new TypeError('options.log4s must be an object');
  }
  if (options.log4js) {
    this.log = options.log4js.getLogger('replContext.js');
    this.log4js = options.log4js;
  } else {
    this.log = log4js.getLogger('replContext.js');
    this.log4js = log4js;
  }
  if (typeof(options.url) !== 'string') {
    throw new TypeError('options.url (string) required');
  }
  if (!options.remoteClientCfg) {
    options.remoteClientCfg = {
      url: options.url,
      log4js: options.log4js
    };
  } else {
    if (typeof(options.remoteClientCfg) !== 'object') {
      throw new TypeError('options.remoteClientCfg must be an object');
    } else {
      options.remoteClientCfg.log4js = options.log4js;
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
      log4js: options.log4js
    };
  } else {
    if (typeof(options.localClientCfg) !== 'object') {
      throw new TypeError('options.localClientCfg must be an object');
    } else {
      options.localClientCfg.log4js = options.log4js;
      options.localClientCfg.url = options.localUrl;
    }
  }
  if (typeof(options.checkpointDn) !== 'string') {
    throw new TypeError('options.checkpointDn (string) required');
  }
  if (typeof(options.replSuffix) !== 'string') {
    throw new TypeError('options.replSuffix (string required');
  }

  this.url = ldapjs.url.parse(options.url, true);
  this.localUrl = ldapjs.url.parse(options.localUrl, true);
  this.replSuffix = options.replSuffix;
  this.log.debug('remote url', this.url);
  this.log.debug('remote DN', this.url.DN.rdns.toString());
  this.checkpoint = new Checkpoint();
  this.entryQueue = new EntryQueue();

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
  self.localClient = ldapjs.createClient(options.localClientCfg);
  self.localClient.once('connect', function(id) {
    self.log.debug('local client connected');
    var auth = self.localUrl.auth;
    // bind if there's auth info in the url
    if (auth) {
      return common.bindClient(auth, self.localClient, self.log,
                               function(err) {
          if (err) {
            self.log.fatal('unable to bind to local client', err);
            process.exit(1);
          } else {
            return initRemoteClient();
          }
      });
    } else {
      return initRemoteClient();
    }
  });

  function initRemoteClient() {
    self.log.debug('creating remote client %j', options.remoteClientCfg);
    self.remoteClient = ldapjs.createClient(options.remoteClientCfg);

    self.remoteClient.once('connect', function(err) {
      self.log.debug('remote client connected');
      // add binding if there's a username/password on the url
      if (self.url.auth) {
        common.bindClient(self.url.auth, self.remoteClient, self.log,
                          function(err) {
          if (err) {
            self.log.fatal('unable to bind to remote client', err);
            process.exit(1);
          }
          return initCheckpoint();

        });
      } else {
        return initCheckpoint();
      }
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

    self.checkpoint.init({
      url: self.checkpointUrl,
      dn: options.checkpointDn,
      localUrl: options.localUrl,
      log4js: options.log4js,
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
      log4js: options.log4js,
      replContext: self
    });
  }

  function startPSearch() {
    self.log.debug('starting persistent search');
    self.remoteClient.search('cn=changelog',
                              {filter: filter, scope: 'sub'},
                              ALL_CHANGES_CTRL,
                              changelogHandler);
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