var common = require('./common');
var emitter = require('events').EventEmitter;
var ldapjs  = require('ldapjs');
var log4js = require('log4js');
var sys = require('sys');


var ENTRY = {
  objectclass: 'changenumber',
  value: 0
};

var SEARCH_OPTIONS = {
  scope: 'base',
  filter: '(objectclass=changenumber)'
};

/**
 * The bucket used to store the change numbers.
 */
Checkpoint.prototype.bucket = null;

/**
 * the remote url
 */
Checkpoint.prototype.url = null;


Checkpoint.prototype.log = null;


Checkpoint.prototype.checkpoint = null;


Checkpoint.prototype.client = null;

/**
 * the checkpoint is stored under this DN, which is of the format uid=url,
 * hash of dn
 */
Checkpoint.prototype.dn = null;
/**
 * The checkpoint API used to store the latest consumed change numbers from the
 * remote url.
 */
function Checkpoint() {
  emitter.call(this);
}

// inherit emitter
sys.inherits(Checkpoint, emitter);
module.exports = Checkpoint;

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
    throw new TYpeError('options.localUrl (string) required');
  }
  if (options.log4js) {
    this.log = options.log4js.getLogger('checkpoint.js');
  } else {
    this.log = log4js.getLogger('checkpoint.js');
  }

  self.log.debug('initializing checkpoint %j', options);

  var urlHash = require("crypto").createHash('md5').update(' ').digest('hex');
  this.dn = 'uid=' + urlHash + ', ' + options.dn;

  this.localUrl = ldapjs.url.parse(options.localUrl, true);

  self.log.debug('creating client');
  this.client = ldapjs.createClient( {
    url: options.localUrl,
    log4js: options.log4js
  });

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

// Checkpoint.prototype.getCheckpoint = function(url, callback) {
//   if (typeof(url) !== 'string') {
//     url = url.href;
//   }
//   return this.riak.get(this.bucket, url, {}, function(err, checkpoint, props) {
//     if (checkpoint) {
//       checkpoint = checkpoint.changenumber;
//     }
//     callback(err, checkpoint, props);
//   });
// };

// Checkpoint.prototype.setCheckpoint = function(url, changenumber, callback) {
//   var self = this;
//   if (typeof(url) !== 'string') {
//     url = url.href;
//   }
//   return this.riak.put(this.bucket,
//                 url,
//                 {changenumber: changenumber},
//                 {},
//                 function(err, changenumber, props) {
//                   if (!err) {
//                     self.checkpoint = changenumber;
//                   }
//                   callback(err, changenumber, props);
//                 });
// };

