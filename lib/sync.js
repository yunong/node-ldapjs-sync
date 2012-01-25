/**
* Copyright 2012 Yunong Xiao, Inc. All rights reserved
*/

var ldapjs = require('ldapjs');
var ldapjsRiak = require('ldapjs-riak');
var log4js = require('log4js');
var Checkpoint = require('./checkpoint');
var EntryQueue = require('./entryQueue');

var ALL_CHANGES_CTRL = new ldapjs.PersistentSearchControl({
  type: '2.16.840.1.113730.3.4.3',
  value: {
    changeTypes: 15,
    changesOnly: false,
    returnECs: true
  }
});

var CHANGES_ONLY_CTRL = new ldapjs.PersistentSearchControl({
  type: '2.16.840.1.113730.3.4.3',
  value: {
    changeTypes: 15,
    changesOnly: true,
    returnECs: true
  }
});


/*
 * Checkpoint object used to store checkpoints
 */
Sync.prototype.checkpoint = null;

/*
* Stores the localClient
*/
Sync.prototype.localClient = null;

/*
* Stores the set of remote LDAP URLs to replicate from.
* In addition, the objects also contain an initialized ldapjs client
* (remoteClient), the last changenumber that was read from the remote
* URL (changenumber), and a queue of entries to be replicated (entries[]).
*/
Sync.prototype.urls = [];


Sync.prototype.log = null;

/**
 * The queue used to store entries that need to be replicated
 */
Sync.prototype.entryQueue = null;

/**
* Constructs a new Sync instance.
* Options takes:
* {
*    "localClient",
*    "urls"
* }
*/
function Sync(options, callback) {
  // private methods
  var self = this;

  function parseUrls(options, urlStr) {
    var myUrl = ldapjs.url.parse(urlStr, true);
    // init the last change number to 0
    myUrl.changenumber = 0;
    myUrl.localClient = self.localClient;
    myUrl.checkpoint = self.checkpoint;
    self.urls.push(myUrl);

    // create a connection to the remote. TODO: Cache clients with the same ip
    myUrl.remoteClient = ldapjs.createClient({
      url: urlStr,
      log4js: options.log4js
    });

    myUrl.entries = [];
    myUrl.changelogs = [];

    // instantiate the persistent search connection once we're connected
    myUrl.remoteClient.once('connect', function(err) {
      var opts = {
        scope: myUrl.scope,
        filter: myUrl.filter,
        attributes: myUrl.attributes
      };
      // TODO: add binding if there's a password
      self.log.debug('registering persistent search client %s %j',
                     myUrl.pathname, opts);
      myUrl.remoteClient.search(myUrl.pathname,
                                opts,
                                ALL_CHANGES_CTRL,
                                searchHandler);
      // register the changelog search
      myUrl.remoteClient.search('cn=changelog',
                                {filter: '(changenumber>=0)', scope: 'sub'},
                                ALL_CHANGES_CTRL,
                                changelogHandler);
    });

    var searchHandler = function(err, res) {
      res.on('searchEntry', function(entry) {
        self.log.debug('got search entry', entry.object);
        // only new events will return an ECs
        var changenumber = entry.object.changenumber;

        if (!changenumber) {
          throw new Error('No changenumber associated with entry, ', entry);
        }

        // otherwise we have a changenumber, so check the changenumber against
        // the latest checkpointed version
        self.log.debug('getting checkpoint for url %s', urlStr);

        self.checkpoint.getCheckpoint(urlStr,
                                      function(err, checkpoint, props) {

          self.log.debug('got checkpoint for url %s', urlStr, err, checkpoint);

          // if the changenumber is greater than the object, write the entry
          if (changenumber > checkpoint.changenumber) {
            self.log.debug('pushing entry %s, for %s', entry, urlStr);
            self.entryQueue.push(myUrl, entry);
          } else {
            self.log.debug('skipping entry %s, current checkpoint %s',
                            changenumber,
                            checkpoint);
          }
        });
      });
      // TODO: ERROR HANDLING, RETRIES
      res.on('end', function() {
        myUrl.remoteClient.search(myUrl.pathname,
                                  opts,
                                  ALL_CHANGES_CTRL,
                                  searchHandler);
      });
    };

    var changelogHandler = function(err, res) {
      res.on('searchEntry', function(entry) {
        self.log.debug('changelog entry %j', entry.object);
        self.entryQueue.pushChangelog(myUrl, entry);
      });

      // TODO: error handling and retries
      res.on('error', function(err) {
        self.log.debug('changelog error', err);
      });

      res.on('end', function() {
        myUrl.remoteClient.search('cn=changelog',
                                  {filter: '(changenumber>=0)', scope: 'sub'},
                                  ALL_CHANGES_CTRL,
                                  changelogHandler);
      });
    };
  }

  // constructor
  if (!options || typeof(options) !== 'object')
    throw new TypeError('options (object) required');
  if (!options.localClient || typeof(options.localClient) !== 'object') {
    throw new TypeError('options.localClient (object) required');
  }
  if (options.log4js && typeof(options.log4js) !== 'object')
    throw new TypeError('options.log4s must be an object');
  if (!options.urls || (!Array.isArray(options.urls) &&
      typeof(options.urls) !== 'string')) {
    throw new TypeError('options.urls (array of string or string) required');
  }
  if (options.checkpoint && typeof(options.checkpoint) !== 'object')
    throw new TypeError('options.checkpoint (object)');
  if (options.log4js)
    this.log = options.log4js.getLogger('sync.js');
  else
    this.log = log4js.getLogger('sync.js');

  this.localClient = options.localClient;
  if (options.checkpoint) {
    this.checkpoint = options.checkpoint;
  } else {
    this.checkpoint = new Checkpoint({
      bucket: 'ldapsync-checkpoints',
      urls: options.urls,
      client: options.localClient
    });
  }

  this.entryQueue = new EntryQueue({
    urls: this.urls,
    log4js: options.log4js
  });

  if (Array.isArray(options.urls)) {
    options.urls.forEach(function(urlStr, index, array){
      parseUrls(options, urlStr);
    });
  } else {
    parseUrls(options, options.urls);
  }


  if (callback)
    return callback();
}
module.exports = Sync;