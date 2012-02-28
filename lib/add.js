/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 *
 * The set of handlers that are specific to ldap add replication.
 * All handlers adhere to the API f(changelog, replContext, next)
 * where changelog is the replicated ldap changelog object, replContext is
 * the ReplContext object, and next is next handler in the chain. Al handlers
 * process.exit(1) on error.
 */


var common = require('./common');
var ldapjs = require('ldapjs');

/**
 * Converts an add changelog to the actual entry, check it against the dn and
 * filter
 */
function changelogToEntry(changelog, replContext, next) {
  var log = replContext.log;
  log.debug('entering changelogToEntry with %j', changelog.object);
  var entry = changelog.object.changes;
  var targetDn = ldapjs.parseDN(changelog.object.targetdn);
  var localDn = replContext.url.DN;
  var filter = replContext.url.filter;
  // parse the changes as json is the entry is stringified.
  if (typeof(entry) === 'string') {
    entry = JSON.parse(entry);
  }
  // cache the entry object
  changelog.remoteEntry = entry;

  if (localDn.parentOf(targetDn) || localDn.equals(targetDn)) {
    if (filter.matches(entry)) {
      log.debug('changelog %j matches filter and dn', changelog.object);
      return next();
    }
  }

  // otherwise, this entry doesn't match so skip straight to writing the
  // checkpoint
  log.debug('changelog %j doesn\'t match filter or dn', changelog.object);
  return common.writeCheckpoint(changelog, replContext, function() {
    return next(true);
  });
}

/**
 * Add changelog.remoteEntry to the local ldap. This also tacks on an _url
 * field to denote which remote server this entry came from.
 */
function add(changelog, replContext, next) {
  var log = replContext.log;
  log.debug('entering add with %j', changelog.object);
  var targetDn = changelog.localDn;
  var entry = changelog.remoteEntry;
  // sneak in the url so we know where this replicated entry comes from.
  entry._url = replContext.url.href;
  log.debug('adding entry %s', targetDn, entry);
  replContext.localPool.acquire(function(err, localClient) {
    if (err) {
      self.log.fatal('unable to acquire client from pool', err);
      process.exit(1);
    }
    localClient.add(targetDn, entry, function(err, res) {
      if (err) {
        log.fatal('unable to write replicated entry', err);
        process.exit(1);
      }
      log.debug('successfully replicated add entry %j', entry);
      replContext.localPool.release(localClient);
      return next();
    });
  });
}

///--- API

module.exports = {
  chain: function(handlers) {
    if (!handlers) {
      handlers = [];
    }

    // handlers for add
    [
      // Check checkpoint
      common.getCheckpoint,
      // Convert the targetDn to the localDn
      common.convertDn,
      // Convert from changelog entry to actualy entry
      // Match virtual entry against dn and filter
      changelogToEntry,
      // Add the entry
      add,
      // Write the new checkpoint
      common.writeCheckpoint
    ].forEach(function(h) {
      handlers.push(h);
    });

    return handlers;
  },

  // for unit tests
  changelogToEntry: changelogToEntry,
  add: add
};