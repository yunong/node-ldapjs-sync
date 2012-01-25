var emitter = require('events').EventEmitter;
var sys = require('sys');
var ldapjs = require('ldapjs');

EntryQueue.prototype.urls = [];

EntryQueue.prototype.log = null;

function EntryQueue(options) {
  this.urls = options.urls;
  this.log = options.log4js.getLogger('entryQueue.js');
  emitter.call(this);

  this.on('gotEntry', function(entry, index, entries, url) {
    this.log.debug('got entry event', url.href);
    this.update(url);
  });

  this.on('write', function(url) {
    this.log.debug('got write event', url.href);
    //TODO: Go delete up to the change number
  });

  this.on('gotChangelog', function(changelog, index, changelogs, url) {
    this.log.debug('got changelog event %s', url.href, changelog.object);
  });
}

// inherit emitter
sys.inherits(EntryQueue, emitter);
module.exports = EntryQueue;

EntryQueue.prototype.push = function(url, entry) {
  this.log.debug('pushing entry into queue,', entry.object);
  var self = this;
  var index = this.urls.indexOf(url);
  if (index === -1)
    this.log.error('url %s doesn\'t exist in queue', url.href);

  var entries = this.urls[index].entries;

  index = entries.push(entry);

  // convenience to print out the entries for logging
  this.entryObjects = [];
  entries.forEach(function(element) {
    self.entryObjects.push(element.object);
  });

  this.log.debug('entries in queue', this.entryObjects);
  self.emit('gotEntry', entry, index, entries, url);
  return self;
};

EntryQueue.prototype.update = function(url) {
  this.log.debug('updating replicated entries', this.entryObjects);
  if (!url.isWrite) {
    this.log.debug('persisting replicated entry for url', url.href);
    url.isWrite = true;
  } else {
    this.log.debug('already writing entry for url %s, aborting', url.href);
    return this;
  }

  var self = this;
  var index = this.urls.indexOf(url);
  if (index === -1) {
    this.log.error('url %s doesn\'t exist in queue', url.href);
    return self;
  }

  var entry = this.urls[index].entries.shift();
  if (!entry) {
    this.log.error('no entries to be written for url', url.href);
    return self;
  }

  var addEntry = {};

  // skip the controls and dn members of the entry
  Object.keys(entry.object).forEach(function(key) {
    if (key != 'controls' && key != 'dn') {
      self.log.debug('adding key', key);
      addEntry[key] = entry.object[key];
    }
  });

  // update the latest checkpoint
  self.log.debug('adding remote entry', addEntry, entry.dn);
  url.localClient.add(entry.dn, addEntry, function(err, res) {
    if (err) {
      self.log.error('unable to add entry to local ldap', err, addEntry,
                      self.entryObjects);
      return self;
    } else {
      self.log.debug('no error on local add'. res);
    }
    // set the checkpoint
    url.checkpoint.setCheckpoint(url.href,
                                 addEntry.changenumber,
                                 function(err, obj, props) {
      if (err) {
        self.log.error('unable to update checkpoint for %s, to %s',
                        url.href,
                        addEntry.changenumber);
        return self;
      } else {
        self.log.debug('update checkpoint to ', addEntry.changenumber);
        // fire off event to advance the delete thread to current cn
        url.isWrite = false;
        self.emit('write', url, entry);
        return self.update(url);
      }
    });
  });
};

EntryQueue.prototype.delete = function(url, entry) {
  this.log.debug('deleting/modifying entries from changelog',
                 this.changelogObjects);
  if (!url.isWriteChangelog) {
    this.log.debug('modifying entries according to changelog for url',
                    url.href);
    url.isWriteChangelog = true;
  } else {
    this.log.debug('already modifying entries from changelog for url %s, aborting', url.href);
    return this;
  }

  var self = this;
  var index = this.urls.indexOf(url);
  if (index === -1) {
    this.log.error('url %s doesn\'t exist in queue', url.href);
    return self;
  }

  var changelog = this.urls[index].changelogs.shift();
  if (!changelog) {
    this.log.error('no changelogs to modify for url', url.href);
    return self;
  }

  // at this point, we want to apply the changelog.
};

EntryQueue.prototype.pushChangelog = function(url, entry) {
  var self = this;
  // skip changelogs that are not modifies or deletes.
  var changetype = entry.object.changetype;
  if (changetype != 'delete' && changetype != 'modify') {
    this.log.debug('changelog type %s isn\'t one of delete or modify, skipping', changetype);
    return;
  }

  var changenumber = entry.object.changenumber;
  // check against the changenumber stored in riak
  url.checkpoint.getChangelogCheckpoint(url.href,
                                        function(err, checkpoint, props) {
    self.log.debug('got changelog checkpoint for url %s', url.href, checkpoint, err);
    // if the changenumber is greater than the checkpoint, push the changelog
    // in to the work queue

    if (changenumber > checkpoint.changenumber) {
      self.log.debug('pushing changelog %s, for %s', entry, url.href);

      var index = this.urls.indexOf(url);
      if (index === -1) {
        this.log.error('url %s doesn\'t exist in queue', url.href);
        return this;
      }


      var changelogs = this.urls[index].changelogs;

      // convenience to print out the entries for logging
      this.changelogObjects = [];
      changelogs.forEach(function(element) {
        self.entryObjects.push(element.object);
      });


      changelogs.push(entry);

      self.emit('gotChangelog', entry, index, changelogs, url);
    } else {
      self.log.debug('skipping entry %s, current checkpoint %s',
                      changenumber,
                      checkpoint);
      return self;
    }
  });
}