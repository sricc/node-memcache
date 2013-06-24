"user strict";
/*
 * Timer Class
 */

//---------------------------------------------------------------------
// Class Definition
//---------------------------------------------------------------------

/**
 * Timer class
 * @param  {boolean} start whether to start the time on instantiation (Default: false)
 */
var Timer = function(start) {
    this.runTime   = 0;
    this.startTime = 0;
    this.stopTime  = 0;

    if (start || false) 
        this.start();
};

/**
 * (STATIC) Current ID being used
 * @type {Number}
 */
Timer.currentId = 0;

//---------------------------------------------------------------------
// Class Methods
//---------------------------------------------------------------------

/**
 * Set the adapter unique ID, used for debugging the connection pool
 */
Timer.prototype.setUniqId = function setUniqId() {
    var id = ++Timer.currentId;

    // Allow a max id of 100000 
    this.id = (id < 100000)
                    ? id
                    : 1;
};

/**
 * Get the run time
 */
Timer.prototype.getRunTime = function getRunTime() {
        return this.runTime;
};

/**
 * Get the start time
 */
Timer.prototype.getStartTime = function getStartTime() {
        return this.startTime;
};

/**
 * Get the stop time
 */
Timer.prototype.getStopTime = function getStopTime() {
        return this.stopTime;
};

/**
 * Start the timer
 */
Timer.prototype.start = function start(id) {
	this.setUniqId();
    this.startTime = new Date().getTime();
};

/**
 * Stop the timer
 */
Timer.prototype.stop = function stop() {
        this.stopTime  = new Date().getTime();
        this.runTime   = (this.stopTime - this.startTime)/1000;

       // debug('Timer ID: '  + this.id + ', Start Time: ' + this.startTime + ', Stop Time: ' + this.stopTime +', Run Time: ' + this.runTime);
       return this.runTime;
}

module.exports = Timer;