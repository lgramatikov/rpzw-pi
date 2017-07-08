'use strict';

const NUMBER_OF_LEDS = 32;

//setup led strip
var strip = require('rpi-ws281x-native');
strip.init(NUMBER_OF_LEDS);
strip.setBrightness(25); // A value between 0 and 255

//setup moment to manage led on/off schedule
var moment = require('moment-timezone');
var startTime = moment.tz('8:30am', 'h:mma', 'Europe/Sofia');
var endTime = moment.tz('7:00pm', 'h:mma', 'Europe/Sofia');
var ledsAreOff = false;

//setup amqp client
var AMQPClient = require('amqp10').Client;
var Policy = require('amqp10').Policy;

var settings = {
	serviceBusHost: process.env.RPZW_SB_NAMESPACE,
	queueName: process.env.RPZW_SB_QUEUE_NAME,
	SASKeyName: process.env.RPZW_SB_SAS_KEY_NAME,
	SASKey: process.env.RPZW_SB_SAS_KEY
};


if (!settings.serviceBusHost || !settings.queueName || !settings.SASKeyName || !settings.SASKey) {
	console.error('Must provide either settings json file or appropriate environment variables.');
	process.exit(1);
}

var protocol = 'amqps';
var serviceBusHost = settings.serviceBusHost + '.servicebus.windows.net';
var sasName = settings.SASKeyName;
var sasKey = settings.SASKey;
var queueName = settings.queueName;

var uri = protocol + '://' + encodeURIComponent(sasName) + ':' + encodeURIComponent(sasKey) + '@' + serviceBusHost;

//leds physical setup is 4 rows, 8 columns each. Array holds RGB color of each led.
var leds = [
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0
];

//There is a slight chance to have two processes trying to deal with leds - one from message and one from idle animation. That's probably uncool.
var animationInProgress = false;

//array with same size as leds, to be used for randomizing
var ids = Array.from({
	length: 32
}, (x, i) => i++);

//randomize ids
var random_indexes = shuffle(ids);

//render startup pattern
var checker = Array.from({
	length: 32
}, (x, i) => {
	return i % 2 === 0 ? Math.floor(Math.random() * 0xffffff) : 0
});
strip.render(checker);

//connect to Azure Service Bus
var client = new AMQPClient(Policy.ServiceBusQueue);
client.connect(uri)
	.then(function () {
		console.log("Connected to: " + serviceBusHost);

		return Promise.all([
			client.createReceiver(queueName)
		]);
	})
	.spread(function (receiver) {
		receiver.on('errorReceived', function (rx_err) {
			leds.fill(0, 0, 15);
			leds.fill(0xff0000, 16, 31);
			strip.render(leds);

			console.warn('===> RX ERROR: ', rx_err);
		});
		receiver.on('message', function (message) {
			handleMessage(message);
		});
	})
	.error(function (e) {
		leds.fill(0, 0, 23);
		leds.fill(0xff0000, 24, 31);
		strip.render(leds);

		console.warn('connection error: ', e);
	});


//idle animation
var idleAnimation = setInterval(handleIdleAnimation, 10000);

function handleMessage(message) {
	//console.log(message);

	var i = 0;
	animationInProgress = true;

	//reset leds by setting color to 0 (i.e. off)
	leds.fill(0);
	strip.render(leds);

	random_indexes = shuffle(ids);

	var timer = setInterval(function () {
		leds[random_indexes[i]] = getColorForStatus(message.body.status);
		strip.render(leds);

		if (i === NUMBER_OF_LEDS) {
			animationInProgress = false;
			clearInterval(timer);
		}

		i = i + 1;
	}, 10);

}

function handleIdleAnimation() {
	if (animationInProgress) {
		return;
	}
		
	if (moment().isBetween(startTime, endTime)) {
		leds.fill(0);
		leds[Math.floor(Math.random() * 31)] = Math.floor(Math.random() * 0xffffff);
		strip.render(leds);
		ledsAreOff = false;
	}
	else {
		if (ledsAreOff===false) {
			leds.fill(0);
			strip.render(leds);
			ledsAreOff = true;
		}
	}
}

//randomize array
function shuffle(array) {
	var currentIndex = array.length, temporaryValue, randomIndex;

	while (0 !== currentIndex) {
		randomIndex = Math.floor(Math.random() * currentIndex);
		currentIndex -= 1;
		temporaryValue = array[currentIndex];
		array[currentIndex] = array[randomIndex];
		array[randomIndex] = temporaryValue;
	}

	return array;
}

//simple mapping between status and led color
function getColorForStatus(status) {
	status = status.toLowerCase();

	var color = 0xffff00;

	if (status === 'start') {
		color = Math.floor(Math.random() * 0xffffff);
	} else if (status === 'success') {
		color = 0x00ff00;
	} else if (status === 'fail') {
		color = 0xff0000
	}

	return color;
}