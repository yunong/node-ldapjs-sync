var ldapjsRiak = require('ldapjs-riak');
var log4js = require('log4js');
/**
 * The handle to the riak store
 */
Checkpoint.prototype.riak = null;

/**
 * The bucket used to store the change numbers.
 */
Checkpoint.prototype.bucket = null;

/**
 *
 */
Checkpoint.prototype.urls = [];


Checkpoint.prototype.log = null;

/**
 * The checkpoint API used to store the latest consumed change numbers from the
 * remote url.
 */
function Checkpoint(options) {
  // private methods
  var self = this;

  // checks the changenumber in riak and if they are null, initializes them
  function checkAndSetChangenumbers() {
    console.log('check and initing change numbers', self.urls);

    self.urls.forEach(function(urlStr) {
      console.log('checking url', urlStr);
      self.getCheckpoint(urlStr, function(err, changenumber, props) {
        if (err == 'NotFoundError') {
          console.log('NotFoundError');
          self.setCheckpoint(urlStr, 0, function(err, obj){
            console.log('setting url check point', err, obj);
          });
        }
        console.log('got check point', changenumber, err, props);
      });
    });

    self.urls.forEach(function(urlStr) {
      self.getChangelogCheckpoint(urlStr, function(err, changenumber, props) {
        if (err == 'NotFoundError') {
          self.setChangelogCheckpoint(urlStr, 0, function(err, obj){
          });
        }
      });
    });
  }

  // constructor
  if (!options || typeof(options) !== 'object')
    throw new TypeError('options (object) required');
  if (!options.bucket || typeof(options.bucket) !== 'string')
    throw new TypeError('options.bucket (string) required');
  if (!options.urls || (!Array.isArray(options.urls) &&
      typeof(options.urls) !== 'string')) {
    throw new TypeError('options.urls (array of string or string) required');
  }
  if (options.client && typeof(options.client) !== 'object') {
    throw new TypeError('options.client must be an object');
  } else {
    options.client = {
      url: 'http://localhost:8098'
    };
  }
  if (options.log4js)
    this.log = options.log4js.getLogger('checkpoint.js');
  else
    this.log = log4js.getLogger('checkpoint.js');

  this.riak = ldapjsRiak.createRiakClient(options.client);
  this.bucket = options.bucket;
  this.urls = (Array.isArray(options.urls)) ? options.urls : [options.urls];

  checkAndSetChangenumbers();
}
module.exports = Checkpoint;

Checkpoint.prototype.getCheckpoint = function(url, callback) {
  if (typeof(url) !== 'string')
    url = url.toString();
  this.riak.get(this.bucket, url, {}, callback);
};

Checkpoint.prototype.setCheckpoint = function(url, changenumber, callback) {
  if (typeof(url) !== 'string')
    url = url.toString();
  this.riak.put(this.bucket,
                url,
                {changenumber: changenumber},
                {},
                callback);
};

Checkpoint.prototype.getChangelogCheckpoint = function(url, callback) {
  if (typeof(url) !== 'string')
    url = url.toString();

  url = url + 'changelog';

  this.riak.get(this.bucket, url, {}, callback);
};

Checkpoint.prototype.setChangelogCheckpoint = function(url,
                                                       changenumber,
                                                       callback) {
  if (typeof(url) !== 'string')
    url = url.toString();

  url = url + 'changelog';

  this.riak.put(this.bucket,
                url,
                {changenumber: changenumber},
                {},
                callback);
};