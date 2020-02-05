
var version = '1.02';

var args = process.argv.slice(2);

var httpServer = 'http://192.168.10.100:8080';
var socketServer = 'http://192.168.10.100:3000';
if (typeof args[0] != 'undefined') {		
    socketServer = 'http://' + args[0];		
}
if (typeof args[1] != 'undefined') {		
    httpServer = 'http://' + args[1];		
}

var spawn = require('child_process').spawn;
var exec  = require('child_process').exec;

var path = require('path');

var socket = require('socket.io-client')(socketServer);

var fs = require('fs');

var FormData = require('form-data');
var request  = require('request');
var timesync = require('timesync');
var robot = require('robotjs');

var os     = require('os');

// Random name generator
var marvel = require('marvel-characters')

var lastReceiveTime;
var takeId;
var updateInProgress = false;

var deviceNamePath = path.join(__dirname, "/device-name");

var projectorName = null;
var ipAddress  = null;
var hostName   = null;
var ts = null;

function boot() {
    console.log("Starting");
    
    hostName = os.hostname();
    
    // Lookup our IP address
    lookupIp();
    
    // Set the device name, either a default or from storage
    projectorName = marvel();
    fs.readFile(deviceNamePath, function(err, buffer){
        if (typeof buffer == 'undefined') {
            return;
        }
        var savedName = buffer.toString();
        if (savedName) {
            projectorName = savedName;
            console.log('saved device name', projectorName);
        }
    });
    
    console.log("Startup complete");
}

socket.on('disconnect', function(){
    ts.destroy();
    ts = null;
    console.log("Disconnected");
});
    
socket.on('connect', function(){
    console.log('A socket connection was made');
    
    socket.emit('projector-online', {name: projectorName, ipAddress: ipAddress, version: version});
    
    //Start the time synchronization instance
    if ( null === ts ){
        ts = timesync.create({
            server: socketServer+'/timesync',
            interval: 10000
        });
        // get notified on changes in the offset
        /*ts.on('change', function (offset) {
            //console.log('offset from system time:', offset, 'ms');
            ts.destroy();
            ts = timesync.create({
                server: socketServer+'/timesync',
                interval: 900000
            });
        });*/
    } else {
        console.warn("Warning: TimeSync instance is initialized before connecting to server!");
    }

    // Setup a regular heartbeat interval
    
    heartbeat();
    var heartbeatIntervalID = setInterval(heartbeat, 1000);
});

socket.on('timeSync-test', function(data){
    var commandIssueTime = data.time;
    var expectedRunningTime = commandIssueTime + data.countDown;
    var commandRecievedTime = ts.now();
    var offset = commandRecievedTime - commandIssueTime;
    var waitTime         = expectedRunningTime - commandRecievedTime - 1;
    
    if ( waitTime < 100 ){
        console.log( "The client cock is way ahead manager clock");
        waitTime = 0;
    }
    
    console.log( "Cmd Recieved delta: " + offset + " Time to wait: " + waitTime );
    setTimeout( function(){
        console.log("Time to Feed back");
        msg = { expectedRunTime: expectedRunningTime, networkLatency: offset, executionTime: ts.now() }
        socket.emit('timeSync-return', msg );
    }, waitTime );
});

socket.on('take-photo', function(data){    
    console.log("Taking a photo");
            
    lastReceiveTime = data.time
    takeId          = data.takeId;
    
    var expectedRunningTime = lastReceiveTime + data.countDown;
    var commandRecievedTime = ts.now();

    var waitTime         = expectedRunningTime - commandRecievedTime - 1;
    
    if ( waitTime < 0 ){    //Act immediately
        waitTime = 0;
    }
    setTimeout(function(){
        socket.emit('timeSync-return', { 
            executeDelta: ts.now() - expectedRunningTime,
            networkLatency: commandRecievedTime - lastReceiveTime
        } );
    }, waitTime );
    
    triggerProjector( expectedRunningTime );
});

socket.on('execute-command', function(data){
    console.log( "Execute : " + data.command );
    var buffer = data.command.split(" ");
    var cmd = String(buffer.splice(0,1));
    var args = buffer;

    execute( data.command );
});

socket.on('update-software', function(data){
    console.log("Updating software");
    
    updateInProgress = true;

    updateSoftware();
});

socket.on('update-name', function(data){
    
    // Name updates go to all devices so only respond if its comes with the devices ip address
    if (data.ipAddress != ipAddress) {
        return;
    }
        
    // If we have a proper name update the camera name, if its being reset switch back to a marvel character
    if (data.newName) {
        projectorName = data.newName;
    } else {
        projectorName = marvel();
    }

    fs.writeFile(deviceNamePath, projectorName, function(err) {
        if (err) {
            console.log("Error saving the device name");
        }
    });

});

function heartbeat() {
    if (ipAddress == null) {
        lookupIp();
    }
      
    socket.emit('projector-online', {name: projectorName, ipAddress: ipAddress, hostName: hostName, version: version, updateInProgress: updateInProgress });
}

function lookupIp() {
    var ifaces = os.networkInterfaces();
    Object.keys(ifaces).forEach(function (ifname) {
      var alias = 0;

      ifaces[ifname].forEach(function (iface) {
        if ('IPv4' !== iface.family || iface.internal !== false) {
          // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
          return;
        }
        ipAddress = iface.address;
      });
    });
}

function tabSpace(){
    robot.keyTap('space');
} 

//@Lip trigger the projector
function triggerProjector( expectedRunningTime ){
    var imagesPath = path.join(__dirname, "/images");
    var process = spawn('bash');

    process.stdout.on('data', function(data){
        console.log( data.toString());
    });
    process.stderr.on('data', function(data){
        console.log( data.toString());
    });
    process.stdin.write('export DISPLAY=:0\n');
    process.stdin.write('feh -FZs ' + imagesPath + '\n');
    process.stdin.end();

    var waitTime = expectedRunningTime - ts.now();
    console.log( waitTime );
    
    setTimeout(tabSpace, waitTime - 1000 );
    setTimeout(tabSpace, waitTime + 200 );
    setTimeout(function(){process.kill();}, waitTime + 3000 );
    
    /*setTimeout(function(){
        robot.keyTap('space');
        socket.emit('timeSync-return', { 
            executeDelta: ts.now() - expectedRunningTime - 50
        } );
    }, waitTime + 50 );*/
}

 //@Lip Execute command
function execute( cmd, callback ) {
    var process = spawn('bash');
    process.stdout.on('data', function(data){
        console.log('stdout: ' + data);
    });
 
     //@Lip max 1hour running time
    var watcher = setTimeout(function(){
        console.log("Force exit");
        process.exit();
    }, 3600000);
    
    if ( undefined == callback ){
        callback = function(code){
            clearTimeout( watcher );
            if (code !== 0) {
                socket.emit('command-error', {takeId:takeId, message:cmd + ' - error '});
                return;
            }
            socket.emit('command-finished', {takeId:takeId, message:cmd + ' - done '});
        };
    }
    
    process.on('exit', callback );
    
    process.stdin.write( cmd + '\n' );
    process.stdin.end();
}

// To update the software we run git pull and npm install and then forcibily kill this process
// Supervisor will then restart it
function updateSoftware() {
    childProcess = exec('cd ' + __dirname + '; git pull', function (error, stdout, stderr) {
        console.log('stdout: ' + stdout);
        console.log('stderr: ' + stderr);
        if (error !== null) {
            console.log('exec error: ' + error);
        }
        process.exit();
    });
}
  
function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}

// Run the boot sequence
boot();
