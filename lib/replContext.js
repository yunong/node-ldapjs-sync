var Checkpoint                     = require('./checkpoint');
var EventEmitter                   = require('events').EventEmitter;
var EntryQueue                     = require('./entryQueue');
var common                         = require('./common');
var ldapjs                         = require('ldapjs');
var sys                            = require('sys');

var ALL_CHANGES_CTRL               = new ldapjs.PersistentSearchControl({
  type: '2.16.840.1.113730.3.4.3',
  value: {
    changeTypes: 15,
    changesOnly: false,
    returnECs: true
  }
});

ReplContext.prototype.checkpoint   = null;

ReplContext.prototype.entryQueue   = null;

ReplContext.prototype.localClient  = null;

ReplContext.prototype.log          = null;

ReplContext.prototype.log4js       = null;

ReplContext.prototype.remoteClient = null;

ReplContext.prototype.url          = null;

ReplContext.prototype.filter       = null;

ReplContext.prototype.replSuffix   = null;

/**
 * This object contains all of the context neccessary for a local client to
 * replicate against a remote URL
 */
function ReplContext(options) {
  var self = this;
  EventEmitter.call(this);
  if (!options || typeof(options) !== 'object') {
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
  if (!options.url || typeof(options.url) !== 'string') {
    throw new TypeError('options.url (string) required');
  }
  if (!options.localUrl || typeof(options.localUrl) !== 'string') {
    throw new TypeError('options.localUrl (string) required');
  }
  if (!options.checkpointDn || typeof(options.checkpointDn) !== 'string') {
    throw new TypeError('options.checkpointDn (string) required');
  }
  if (!options.replSuffix || typeof(options.replSuffix) !== 'string') {
    throw new TypeError('options.replSuffix (string required');
  }

  this.url = ldapjs.url.parse(options.url, true);
  this.localUrl = ldapjs.url.parse(options.localUrl, true);
  this.replSuffix = options.replSuffix;
  this.log.debug('remote url', this.url);
  this.log.debug('remote DN', this.url.DN.rdns.toString());
  this.checkpoint = new Checkpoint();
  this.entryQueue = new EntryQueue();

  /**
   * Initialization happens serially in the following manner:
   * 1) init the local client
   * 2) init the remote client
   * 3) init the checkpoint
   * 4) init the entry queue
   * 5) start the remotepersistent search
   */

  this.localClient = ldapjs.createClient({
    url: options.localUrl,
    log4js: options.log4js
  });

  this.localClient.once('connect', function(id) {
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
    self.log.debug('creating remote client');
    self.remoteClient = ldapjs.createClient({
      url: options.url,
      log4js: options.log4js
    });

    self.remoteClient.once('connect', function(err) {
      self.log.debug('remote client connected');
      // add binding if there's a username/password on the url
      if (self.url.auth) {
        common.bindClient(self.url.auth, self.remoteClient, self.log,
                          function(err){
          if (err) {
            self.log.fatal('unable to bind to remote client', err);
            system.exit(1);
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
      url: options.url,
      dn: options.checkpointDn,
      localUrl: options.localUrl,
      log4js: options.log4js
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

  var changelogHandler = function(err, res) {
    res.on('searchEntry', function(entry) {
      self.log.debug('changelog entry %j', entry.object);
      self.entryQueue.push(entry);
    });

    // TODO: error handling and retries
    res.on('error', function(err) {
      self.log.error('changelog error', err);
      throw new Error('unable to instantiate persistent search to remote',
                       err);
    });

    self.log.info('fully initialized, sending init event');
    self.emit('init', self);
  };
}

sys.inherits(ReplContext, EventEmitter);
module.exports = ReplContext;

