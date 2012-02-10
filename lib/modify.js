var common = require('./common');

function determineModify(changelog, replContext, next) {
  var log = replContext.log4js.getLogger('modify.js');
  log.debug('entering determinemodify with %j', changelog.object);
  var localEntry = changelog.localEntry;
  var remoteEntry = changelog.object.entry;
  // entry is sent back as a string
  if (typeof(remoteEntry) === 'string') {
    remoteEntry = JSON.parse(remoteEntry);
  }
  var filter = replContext.url.filter;
  var remoteMatch = filter.matches(remoteEntry);
  var targetDn = changelog.object.targetdn;

  var addEntry = function() {
    replContext.localClient.add(targetDn, remoteEntry, function(err, res) {
      if (err) {
        log.fatal('unable to write replicated entry', err);
        process.exit(1);
      }
      log.debug('successfully replicated add entry %j', remoteEntry);
      return next();
    });
  };

  var deleteEntry = function() {
    replContext.localClient.del(targetDn, function(err, res) {
      //TODO: Recursive delete locally?
      if (err) {
        log.fatal('unable to delete %j', localEntry, err);
        process.exit(1);
      }
      log.debug('deleted local entry %j and exiting', localEntry.object);
      return next();
    });
  };

  var changes = changelog.object.changes;
  if (typeof(changes) === 'string') {
    changes = JSON.parse(changes);
  }
  var modEntry = function() {
    replContext.localClient.modify(targetDn, changes, function(err, res) {
      if (err) {
        log.fatal('unable to modify %j', localEntry, err);
        process.exit(1);
      }
      log.debug('modified local entry %j and exiting', localEntry.object);
      return next();
    });
  };

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
    // modify local entry
    modEntry();
  } else if (!localMatch && !remoteMatch) {
    // ignore
    return next();
  } else if (localMatch && !remoteMatch) {
    // delete local entry
    deleteEntry();
  } else if (!localMatch && remoteMatch) {
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

    [
      // handlers for modify
      // Check checkpoint
      common.getCheckpoint,
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
