/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 *
 * The set of handlers that are specific to ldap modify replication.
 * All handlers adhere to the API f(changelog, replContext, next)
 * where changelog is the replicated ldap changelog object, replContext is
 * the ReplContext object, and next is next handler in the chain. Al handlers
 * process.exit(1) on error.
 */

var common = require('./common');
var ldapjs = require('ldapjs');

var Attribute = ldapjs.Attribute;
var Change = ldapjs.Change;

var utils = require('util');
/**
 * Determines what action to take given a modify changelog.
 * The modification case of replication is quite complicated, with the
 * following possible cases:
 * 1) Both modified and unmodified entries match the filter. (modify)
 * 2) Neither entry matches the filter. (do nothing)
 * 3) The modified entry doesn't match the filter, but the unmodified entry
 *    does. (delete)
 * 4) The modified entry matches the filter, but the unmodified entry does not.
 *    (modify)
 * 5) The entry does not exist locally, but the remote modified entry matches
 *    the filter. (add)
 *
 * The localEntry is stored under changelog.localEntry
 * The remoteEntry is stored under changelog.object.entry
 */
function determineModify(changelog, replContext, next) {
  var log = replContext.log;
  // var log = replContext.log4js.getLogger('modify.js');
  log.debug('entering determinemodify with %j', changelog.object);
  var localEntry = changelog.localEntry;
  var remoteEntry = changelog.object.entry;
  // entry is sent back as a string
  if (typeof(remoteEntry) === 'string') {
    remoteEntry = JSON.parse(remoteEntry);
  }
  var filter = replContext.url.filter;
  var remoteMatch = filter.matches(remoteEntry);
  var targetDn = changelog.localDn;

  function addEntry() {
    replContext.localClient.add(targetDn, remoteEntry, function(err, res) {
      if (err) {
        log.fatal('unable to write replicated entry', err);
        process.exit(1);
      }
      log.debug('successfully replicated add entry %j', remoteEntry);
      return next();
    });
  }

  function deleteEntry() {
    replContext.localClient.del(targetDn, function(err, res) {
      //TODO: Recursive delete locally?
      if (err) {
        log.fatal('unable to delete %j', localEntry, err);
        process.exit(1);
      }
      log.debug('deleted local entry %j and exiting', localEntry.object);
      return next();
    });
  }

  var changes = changelog.object.changes;
  log.debug('changelog changes', changes);
  if (typeof(changes) === 'string') {
    changes = JSON.parse(changes);
    log.debug('parsed changes to a json object', changes);
  }

  log.debug('parsing changes in to ldapjs.Changes');
  var c = [];
  changes.forEach(function(element) {
    var change = new Change({
      type: element.operation,
      modification: new Attribute({
        type: element.modification.type,
        vals: element.modification.vals
      })
    });
    c.push(change);
  });
  log.debug('parsed changes to ldapjs.Changes', c);

  function modEntry() {
    log.debug('modifying entry %s with changes', targetDn, c);
    console.log(utils.inspect(c), utils.inspect(changelog.object.changes));
    console.log(c == changelog.object.changes);
    replContext.localClient.modify(targetDn, c, function(err, res) {
      if (err) {
        log.fatal('unable to modify %s', targetDn, err);
        return setTimeout(function() {process.exit(1);}, 2000);
      }
      log.debug('modified local entry %j and exiting', localEntry.object);
      return next();
    });
  }

  if (!localEntry) {
    if (remoteMatch) {
      // add entry since the entry never existed but now matches
      return addEntry();
    } else {
      // local entry dne, remote entry doesn't match, bail
      return common.writeCheckpoint(changelog, replContext, function() {
        return next(true);
      });
    }
  }

  var localMatch = filter.matches(localEntry.object);
  // at this stage, both local and remote entries exist.
  if (localMatch && remoteMatch) {
    log.debug('local and remote match');
    // modify local entry
    modEntry();
  } else if (!localMatch && !remoteMatch) {
    log.debug('neither local or remote match, skipping');
    // ignore
    return next();
  } else if (localMatch && !remoteMatch) {
    log.debug('remote doesn\'nt match, local does, deleting entry');
    // delete local entry
    deleteEntry();
  } else if (!localMatch && remoteMatch) {
    log.debug('local doesn\'t match, remote matches, modifying');
    // modify local entry to match
    modEntry();
  }
}

///--- API

module.exports = {
  chain: function(handlers) {
    if (!handlers) {
      handlers = [];
    }

    // handlers for modify
    [
      // Check checkpoint
      common.getCheckpoint,
      // Convert the targetDn to the localDn
      common.convertDn,
      // Search locally for entry by DN
      common.localSearch,
      // Compare modified entry against local entry
      // Determine course of action, add, or delete.
      determineModify,
      // Write the new checkpoint
      common.writeCheckpoint
    ].forEach(function(h) {
      handlers.push(h);
    });

    return handlers;
  },
  determineModify: determineModify
};
