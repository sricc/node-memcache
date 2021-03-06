/**
 * Copyright (c) 2011 Tim Eggert
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * @author Tim Eggert <tim@elbart.com>
 * @license http://www.opensource.org/licenses/mit-license.html MIT License
 */

var tcp = require('net'),
    util = require('util'),
    Pool = require('node-pool-monkey'),
    Timer = require('./Timer');

var crlf = "\r\n";
var crlf_len = crlf.length;

var error_replies = ['ERROR', 'NOT_FOUND', 'CLIENT_ERROR', 'SERVER_ERROR'];

var Client = exports.Client = function(port, host, options) {
    this.port = port || 11211;
    this.host = host || 'localhost';
    this.buffer = '';
    this.pool = null;
    this.sends = 0;
    this.replies = 0;
    this.handles = [];
    this.options = options || {};
};

util.inherits(Client, process.EventEmitter);

Client.prototype._createConnection = function(callback) {
	var self       = this;
	var connection = new tcp.createConnection(self.port, self.host);

	connection.addListener("connect", function () {
      	this.setTimeout(0);          // try to stay connected.
      	this.setNoDelay();
  		self.emit("connect");
		self.dispatchHandles();
    });

    connection.addListener("data", function (data) {
    	var time = this.timer.stop();
    	self.buffer += data;
  		// util.debug(data);
    	self.recieves += 1;
    	self.handle_received_data(this.callback, time, this.id);
    	self.pool.release(this);
    });

    /*connection.addListener("close", function () {
      self.emit("close");
      self.pool.removeFromPool(this);
    });

    connection.addListener("timeout", function () {
      conn = null;
      self.emit("timeout");
      self.pool.release(this);
    });

    connection.addListener("error", function (ex) {
      conn = null;
      self.emit("error", ex);
      self.pool.release(this);
    });*/

	callback(null, connection);
};

Client.prototype.connect = function (callback) {
	var self = this;
	function acquire(cb) {
	    self.pool.acquire(function(error, conn) {
	       cb(error, conn);
	   });
	}

	if (this.pool) 
		return acquire(callback);

	Pool({
    	create: function(callback) {
    		self._createConnection(callback);
    	},
    	destroy: function(connection, callback) {
    		callback(null, connection.end());
    	},
    	min:         self.options.min || 1,
    	max:         self.options.max || 10,
    	idleTimeout: self.options.idleTimeout || 3000,
     	// log:         true
    }, function(error, pool) {
    	if (error) return console.log('Pool Error:', error.message);

    	self.pool = pool;
    	acquire(callback);
    });
};

Client.prototype.addHandler = function(callback) {
    this.handles.push(callback);

    // if (this.conn.readyState == 'open') {
        this.dispatchHandles();
    // }
};

Client.prototype.dispatchHandles = function() {
    for (var i in this.handles) {
        var handle = this.handles.shift();
        // util.debug('dispatching handle ' + handle);
        if (typeof handle !== 'undefined') {
            handle();
        }
    }
};

Client.prototype.query = function(query, type, callback) {
	var self = this;
	this.sends++;
	this.connect(function(error, conn) {
		conn.timer    = new Timer(true);
		conn.callback = { type: type, fun: callback };
		conn.write(query + crlf);
	});
};

Client.prototype.close = function() {
	this.pool.drain();
};

Client.prototype.get = function(key, callback) {
	return this.query('get ' + key, 'get', callback);
};


// all of these store ops (everything bu "cas") have the same format
Client.prototype.set     = function(key, value, callback, lifetime, flags) { return this.store('set',     key, value, callback, lifetime, flags); }
Client.prototype.add     = function(key, value, callback, lifetime, flags) { return this.store('add',     key, value, callback, lifetime, flags); }
Client.prototype.replace = function(key, value, callback, lifetime, flags) { return this.store('replace', key, value, callback, lifetime, flags); }
Client.prototype.append  = function(key, value, callback, lifetime, flags) { return this.store('append',  key, value, callback, lifetime, flags); }
Client.prototype.prepend = function(key, value, callback, lifetime, flags) { return this.store('prepend', key, value, callback, lifetime, flags); }
Client.prototype.store   = function(cmd, key, value, callback, lifetime, flags) {

	if (typeof(callback) != 'function') {
		lifetime = callback;
		callback = null;
	}

	var set_flags = flags || 0;
	var exp_time  = lifetime || 0;
    var tml_buf = new Buffer(value.toString());
	var value_len = tml_buf.length || 0;
	var query = [cmd, key, set_flags, exp_time, value_len];

	return this.query(query.join(' ') + crlf + value, 'simple', callback);
};

// "cas" is a store op that takes an extra "unique" argument
Client.prototype.cas = function(key, value, unique, callback, lifetime, flags) {

	if (typeof(callback) != 'function') {
		lifetime = callback;
		callback = null;
	}

	var set_flags = flags || 0;
	var exp_time  = lifetime || 0;
	var value_len = value.length || 0;
	var query = ['cas', key, set_flags, exp_time, value_len, unique];

	return this.query(query.join(' ') + crlf + value, 'simple', callback);
};


Client.prototype.del = function(key, callback){
	util.error("mc.del() is deprecated - use mc.delete() instead");
	return this.delete(key, callback);
};

Client.prototype.delete = function(key, callback){
	return this.query('delete ' + key, 'simple', callback);
};

Client.prototype.version = function(callback) {
	return this.query('version', 'version', callback);
};

Client.prototype.increment = function(key, value, callback) {

	if (typeof(value) == 'function') {
		callback = value;
		value = 1;;
	}

	value = value || 1;
	return this.query('incr ' + key + ' ' + value, 'simple', callback);
};

Client.prototype.decrement = function(key, value, callback) {

	if (typeof(value) == 'function') {
		callback = value;
		value = 1;;
	}

	value = value || 1;
	return this.query('decr ' + key + ' ' + value, 'simple', callback);
};

Client.prototype.stats = function(type, callback){

	if (typeof(type) == 'function'){
		callback = type;
		type = null;
	}

	if (type){
		return this.query('stats '+type, 'stats', callback);
	}else{
		return this.query('stats', 'stats', callback);
	}
}

Client.prototype.handle_received_data = function(currentCallback, queryTime, id) {

	while (this.buffer.length > 0){

		var result = this.determine_reply_handler(this.buffer, currentCallback);

		if (result == null){
			break;
		}

		var result_value = result[0];
		var next_result_at = result[1];
		var result_error = result[2];

		// does the current message need more data than we have?
		// (this is how "get" ops ensure we've gotten all the data)
		if (next_result_at > this.buffer.length){
			break;
		}

		this.buffer = this.buffer.substring(next_result_at);

		// var callback = this.callbacks.shift();
		if (currentCallback != null && currentCallback.fun){
			this.replies++;
			currentCallback.fun(result_error, result_value, queryTime, id);
		}
	}
};

Client.prototype.determine_reply_handler = function (buffer, currentCallback){

	// check we have a whole line in the buffer
	var crlf_at = buffer.indexOf(crlf);
	if (crlf_at == -1){
		return null;
	}

	// determine errors
	for (var error_idx in error_replies){
		var error_indicator = error_replies[error_idx];
		if (buffer.indexOf(error_indicator) == 0) {
			return this.handle_error(buffer);
		}
	}

	// call the handler for the current message type
	// var type = this.callbacks[0].type;
	var type = currentCallback.type;
	if (type){
		return this['handle_' + type](buffer);
	}

	return null;
};

Client.prototype.handle_get = function(buffer) {
    var next_result_at = 0;
    var result_value = null;
    var end_indicator_len = 3;
    var result_len = 0;

    if (buffer.indexOf('END') == 0) {
        return [result_value, end_indicator_len + crlf_len];
    } else if (buffer.indexOf('VALUE') == 0 && buffer.indexOf('END') != -1) {
        first_line_len = buffer.indexOf(crlf) + crlf_len;
        var end_indicator_start = buffer.indexOf('END');
        result_len = end_indicator_start - first_line_len - crlf_len;
        result_value = buffer.substr(first_line_len, result_len);
        return [result_value, first_line_len + parseInt(result_len, 10) + crlf_len + end_indicator_len + crlf_len]
    } else {
        var first_line_len = buffer.indexOf(crlf) + crlf_len;
        var result_len     = buffer.substr(0, first_line_len).split(' ')[3];
        result_value       = buffer.substr(first_line_len, result_len);

        return [result_value, first_line_len + parseInt(result_len ) + crlf_len + end_indicator_len + crlf_len];
    }
};

Client.prototype.handle_stats = function(buffer){

	// special case - no stats at all
	if (buffer.indexOf('END') == 0){
		return [{}, 5];
	}

	// find the terminator
	var idx = buffer.indexOf('\r\nEND\r\n');
	if (idx == -1){
		// wait for more data if we don't have an end yet
		return null;
	}

	// read the lines
	var our_data = buffer.substr(0, idx+2);
	var out = {};
	var line = null;
	var i=0;
	while (line = readLine(our_data)){
		our_data = our_data.substr(line.length + 2);
		if (line.substr(0, 5) == 'STAT '){
			var idx2 = line.indexOf(' ', 5);
			var k = line.substr(5, idx2-5);
			var v = line.substr(idx2+1);
			out[k] = v;
		}
	}

	return [out, idx + 7, null];
};

Client.prototype.handle_simple = function(buffer){
	var line = readLine(buffer);
	return [line, (line.length + crlf_len), null];
};

Client.prototype.handle_version = function(buffer){
	var line_len      = buffer.indexOf(crlf);
	var indicator_len = 'VERSION '.length;
	var result_value  = buffer.substr(indicator_len, (line_len - indicator_len));
	return [result_value, line_len + crlf_len, null];
};

Client.prototype.handle_error = function(buffer){
	var line = readLine(buffer);
	return [null, (line.length + crlf_len), line];
};

readLine = function(string){
	var line_len = string.indexOf(crlf);
	return string.substr(0, line_len);
};