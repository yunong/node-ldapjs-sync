var add          = require('./add.js');
var modify       = require('./modify.js');
var del          = require('./delete.js');
var EventEmitter = require('events').EventEmitter;
var ldapjs       = require('ldapjs');

var parseDN      = ldapjs.parseDN;
var sys          = require('sys');

EntryQueue.prototype.url         = null;

EntryQueue.prototype.log         = null;

EntryQueue.prototype.queue       = null;

EntryQueue.prototype.replContext = null;

EntryQueue.prototype.isPopping   = null;

function EntryQueue() {
  EventEmitter.call(this);
}

// inherit EventEmitter
sys.inherits(EntryQueue, EventEmitter);
module.exports = EntryQueue;

EntryQueue.prototype.init = function(options) {
  this.url = options.url;
  this.log = options.log4js.getLogger('entryQueue.js');
  this.log.debug('initializing entryqueue');
  this.replContext = options.replContext;
  this.queue = [];

  this.on('push', function(changelog, index, queue) {
    this.log.debug('got push event');
    this.pop();
  });

  this.on('write', function(url) {
    this.log.debug('got write event', url.href);
    //TODO: Go delete up to the change number
  });

  this.on('gotChangelog', function(changelog, index, changelogs, url) {
    this.log.debug('got changelog event %s', url.href, changelog.object);
  });

  // emit init on initialization
  this.log.debug('entryqueue initialized, emiting init event');
  return this.emit('init', this);
};

EntryQueue.prototype.push = function(changelog) {
  this.log.debug('entering EntryQueue.push with %j', changelog.object);
  // create the appropriate add/modify/delete entry based on type and insert
  // into queue
  switch(changelog.object.changetype) {
    case 'add':
      // checking for handlers is for unit tests so they can stub out a handler
      if (!changelog.handlers) {
        changelog.handlers = add.chain();
      }
      break;
    case 'delete':
      // checking for handlers is for unit tests so they can stub out a handler
      if (!changelog.handlers) {
        changelog.handlers = del.chain();
      }
      break;
    case 'modify':
      // checking for handlers is for unit tests so they can stub out a handler
      if (!changelog.handlers) {
        changelog.handlers = modify.chain();
      }
      break;
    default:
      throw new TypeError('changelog type not one of add, delete or modify',
                           changelog.object);
  }
  this.log.debug('pushing changelog %j into queue', changelog.object);
  var index = this.queue.push(changelog);
  this.log.debug('exiting EntryQueue.push');
  this.emit('push', changelog, index, this.queue);
};

/**
 * The main event loop that continously pops entries from the queue.
 * We want the event loop to continue serially one entry at a time.
 */
EntryQueue.prototype.pop = function() {
  this.log.debug('entering entryQueue.pop with queue', this.queue);
  var self = this;
  if(this.isPopping) {
    return self;
  }

  // set status to pop
  this.isPopping = true;

  var changelog = this.queue.shift();
  // if the queue is empty, then set isPop to false and return
  if (!changelog) {
    this.isPopping = false;
    this.emit('empty', self);
    this.log.debug('empty queue, exiting');
    return self;
  }

  var handlers = changelog.handlers;

  // the function that is used to clean up this entry
  var finishPop = function() {
    self.log.debug('exiting pop for changelog %j', changelog.object);
    // set status to false
    self.isPopping = false;
    self.emit('popped', changelog, self);
    // pop another changelog from the queue
    self.pop();
  };

  // do work serially based on changelog handler
  var i = 0;
  var handlerInvoker = function(bail) {
    if (bail) {
      return finishPop();
    }
    if (handlers[i]) {
      // recursively call with handlerInvoker as next
      self.log.debug('calling handler ', handlers[i]);
      handlers[i++].call(self, changelog, self.replContext, handlerInvoker);
    } else {
      self.log.debug('finished all handlers, exiting');
      return finishPop();
    }
  };

  handlerInvoker();
};