'use strict';

var childProcess = require('child_process')
  , fs = require('fs')
  , os = require('os')
  , path = require('path')
  , readline = require('readline')
  , util = require('util');

var _ = require('lodash')
  , async = require('async')
  , tfunk = require('tfunk');


const WHATSOUND_PATH = path.join(os.homedir(), 'dr-whatsound');
const DEBUG = !!process.env.DEBUG;


function debug() {
  if (DEBUG) {
    console.log(tfunk(util.format.apply(null, arguments)));
  }
}


var getPlayer;
(function() {
  let players = ['mplayer', 'afplay', 'mpg123', 'mpg321', 'play'];

  function _getPlayer(callback) {
    debug('{green:Look for player %s}', players[0]);
    childProcess.exec('which ' + players[0], function(err, stdout, stderr) {
      if (err || !stdout) {
        debug('{yellow:Didn’t find player %s}', players[0]);
        if (players.length === 0) {
          return callback(err);
        }

        players.shift();
        setImmediate(_getPlayer);
      }

      var player = players[0];
      debug('{green:Found player %s}', player);

      callback(null, function(pth, callback) {
        debug('{orange:' + player + ' ' + pth + '}');
        childProcess.exec(player + ' ' + pth, callback);
      });
    });
  }

  getPlayer = async.memoize(_getPlayer);
})();


var listDirs = async.memoize(_.partial(fs.readdir, WHATSOUND_PATH));


var currentFiles
  , currentFile;

function prep(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^A-Za-z0-9#♭]+/g, ' ');
}

function equivalent(actual, expected) {
  debug('{green:Compare {bold:%s} and {white:%s}}', expected, actual);

  actual = prep(actual);
  expected = prep(expected);

  if (actual === expected) {
    return true;
  }

  let xs = actual.split(/\s+/)
    , ys = expected.split(/\s+/);
  debug('{green:Compare {bold:%s} and {white:%s}}', ys, xs);

  return _.isEqual(xs, ys);
}

function welcome() {
  console.log(tfunk(
    'Welcome to {bold:Dr. Whatsound}.\n\n' +
    'Select a set of sounds from the menu by typing the number you want.\n\n' +
    'Dr. Whatsound will play you a sound. You should then type in the note or\n' +
    'chord corresponding to it. If the file contains several (relevant) sounds,\n' +
    'separate them with semicolons.\n\n' +
    'For example, if Dr. Whatsound plays you {bold:C#}, just type in {yellow:C#}. ' +
    'If Dr. Whatsound\nplays you an {bold:A major (open)} chord, type in ' +
    '{yellow:A major (open)}, or {yellow: A major open},\nor {yellow:A major/open}… ' +
    'If Dr. Whatsound plays a sequence {bold:A, B, A, D}, enter {yellow:A;B;A;D}.\n' +
    //'To represent a {bold:sharp} note, just type {bold:#} as in {bold:C#}.\n' +
    //'To represent a {bold:flat} note, like {bold:D♭}, type {bold:D:b}.}\n' +
    ''
  ));
}

function showMenu() {
  listDirs(function(err, dirs) {
    if (err) {
      if (err.code === 'ENOENT') {
        console.log(
          tfunk('{red:Dr. Whatsound looks for directories under {yellow:~/dr-whatsound}, ' +
                  'but couldn’t find any.}'));
        process.exit(1);
      }

      throw err;
    }

    if (dirs.length === 0) {
      console.log(tfunk('{yellow:Dr. Whatsound looks for directories under ' +
                        '{yellow:~/dr-whatsound}, but ~/dr-whatsound is ' +
                        'empty.}'));
      process.exit(2);
    }

    dirs.sort();

    console.log(tfunk('\n{white:Please select a collection}'));

    var i = 1;
    _.each(dirs, function(dir) {
      console.log(tfunk(util.format('{white: {bold:%s}}\t{yellow:%s}', i++, dir)));
    });

    cli.prompt();
  });
}

function processMenu(selection) {
  listDirs(function(err, dirs) {
    if (isNaN(selection) || Number(selection) <= 0 || Number(selection) > dirs.length) {
      console.log(tfunk('{yellow:Invalid selection; please choose a number {white:1–' + dirs.length + '}}'));
      cli.prompt();

    } else {
      mode = 'guess';
      selectDir(dirs[Number(selection) - 1]);
    }
  });
}

function selectDir(dir) {
  fs.readdir(path.join(WHATSOUND_PATH, dir), function(err, files) {
    if (err) throw err;

    currentFiles = _.chain(files).
      filter(function(fileName) {
        return /.*\.(mp3|mp4|wav|ogg)$/.test(fileName);
      }).
      map(function(fileName) {
        return path.resolve(path.join(WHATSOUND_PATH, dir, fileName));
      }).
      value();
    debug('{green:Files in directory %s: %s', dir, JSON.stringify(currentFiles));

    if (!currentFiles || currentFiles.length === 0) {
      console.log(tfunk('{red:Dr. Whatsound couldn’t find any files!'));
      process.exit(3);
    }

    console.log(tfunk(util.format('\nDr. Whatsound will now test you on {bold:%s}…', dir)));
    console.log('The possible answers are');
    _.each(currentFiles, function(f) {
      var ans = prep(path.basename(f, path.extname(f)));
      ans = ans[0].toUpperCase() + ans.substr(1);
      console.log('\t' + ans);
    });
    nextGuess();
  });
}

var totalGuesses = 0
  , totalTrials = 0
  , rightAtOnce = 0
  , tries = 0;

function nextGuess() {
  ++totalTrials;
  debug('{green:Select a random file from %s}', JSON.stringify((currentFiles)));
  currentFile = _.sample(currentFiles);
  currentAnswer = path.basename(currentFile, path.extname(currentFile));
  debug('{green:Selected file: %s (answer: %s)}', currentFile, currentAnswer);
  promptGuess();
}

function promptGuess() {
  getPlayer(function(err, player) {
    if (err) throw err;

    player(currentFile, function() {
      console.log('Please identify the mystery sound');
      cli.prompt();
    });
  });
}

var mode = 'menu';

var cli = readline.createInterface(process.stdin, process.stdout);
cli.setPrompt('» ');
welcome();
showMenu();

cli.on('SIGINT', function() {
  switch (mode) {
    case 'guess':
      debug('{green:Back out of guess mode to menu mode}');
      mode = 'menu';
      showMenu();
      break;

    default:
      process.exit(0);
      break;
  }
});


var currentAnswer;

function processGuess(guess) {
  ++totalGuesses;
  ++tries;
  if (equivalent(guess, currentAnswer)) {
    console.log(tfunk('{green:✓}'));
    setImmediate(nextGuess);
    if (tries === 1) {
      rightAtOnce++;
    }
    tries = 0;
    console.log(tfunk(util.format('{green:%s/%s trials correct on the first try}', rightAtOnce, totalTrials)))

  } else if (tries === 3) {
    console.log(tfunk('{red:✕}'));
    console.log(tfunk(util.format('{yellow:The correct answer was {bold:%s}}', currentAnswer)));
    console.log('\nLet’s try another one…')
    setImmediate(nextGuess);
    tries = 0;

  } else {
    console.log(tfunk('{red:✕}'));
    cli.prompt();
  }
}


cli.on('line', function(line) {
  cli.pause();
  switch(mode) {
    case 'guess':
      debug('{green:Process guess:} {white:%s}', line.trim());
      setImmediate(_.partial(processGuess, line.trim()));
      break;
    case 'menu':
      debug('{green:Process menu selection:} {white:%s}', line.trim());
      setImmediate(_.partial(processMenu, line.trim()));
      break;
    default:
      console.log(
        tfunk('{red:Dr. Whatsound does not know what to make of “{yellow:%s}”', line.trim()));
  }
}).on('close', function() {
  console.log('Good-bye from Dr. Whatsound');
  process.exit(0);
});
