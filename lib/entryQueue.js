/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */


var EventEmitter = require('events').EventEmitter;

var add          = require('./add.js');
var del          = require('./delete.js');
var modify       = require('./modify.js');
var sys          = require('sys');


/**
 * The global flag used to denote that an entry is in process
 */
EntryQueue.prototype.isInprocess   = null;

/**
 * The logger
 */
EntryQueue.prototype.log         = null;

/**
 * The FIFO queue that entries are stored in.
 */
EntryQueue.prototype.queue       = null;

/**
 * The replication context object. See replContext.js
 */
EntryQueue.prototype.replContext = null;

/**
 * The EntryQueue object is a FIFO queue used to process replication changelogs
 * in a serial fashion.
 *
 * Create this object as follows:
 *
 *  var entryQueue = new EntryQueue();
 *  entryQueue.once('init', function(eq) {
 *    console.log('entry queue has been initialized', eq);
 *  })
 *  entryQueue.init();
 *
 * Note this object is created asynchronously by invoking init. Calling new
 * merely gives consumer a handle to the object. The handle allows consumers
 * to listen for the init event.
 */
function EntryQueue() {
  EventEmitter.call(this);
}

// inherit EventEmitter
sys.inherits(EntryQueue, EventEmitter);
module.exports = EntryQueue;

/**
 * Initializes the EntryQueue object.
 * @param options : the set of options for the EntryQueue {
 *   replContext: the replication context object
 * }
 }
 */
EntryQueue.prototype.init = function(options) {
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
  });

  this.on('gotChangelog', function(changelog, index, changelogs, url) {
    this.log.debug('got changelog event %s', url.href, changelog.object);
  });

  // emit init on initialization
  this.log.debug('entryqueue initialized, emiting init event');
  return this.emit('init', this);
};

/**
 * pushes a changelog entry into the queue. emits a 'push' event when done
 * @param : changelog, the changelog entry
 */
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
 * an 'popped' event is emitted whenever a changelog has been completely
 * processed.
 */
EntryQueue.prototype.pop = function() {
  this.log.debug('entering entryQueue.pop with queue');
  var self = this;
  if(this.isInprocess) {
    return self;
  }

  // set status to pop
  this.isInprocess = true;

  var changelog = this.queue.shift();
  // if the queue is empty, then set isPop to false and return
  if (!changelog) {
    this.isInprocess = false;
    this.emit('empty', self);
    this.log.debug('empty queue, exiting');
    return self;
  }

  var handlers = changelog.handlers;

  // the function that is used to clean up this entry
  var finishPop = function() {
    self.log.debug('exiting pop for changelog %j', changelog.object);
    // set status to false
    self.isInprocess = false;
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