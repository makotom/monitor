(function(){
	"use strict";

	var PSK1 = "",
	PSK2 = "",
	USER_LIST = "users.csv",
	LOG_FILE = "log.csv",
	CLI_HTML = "cli.html",
	SSL_KEY = "key.pem",
	SSL_CERT = "cert.pem",

	SRV_PORT = 443,
	PING_INTERVAL = 30000,

	fs = require("fs"), https = require("https"), ws = require("ws");

	(function(){
		var User = function(uid, fullname){
			return {
				uid : uid.toString(),
				fullname : fullname.toString(),
				status : 0,
				updated : NaN
			};
		},

		Event = function(uid, type){
			return {
				time : new Date().getTime(),
				uid : uid.toString(),
				type : parseInt(type, 10)
			};
		},

		Journal = function(){
			var userList = fs.readFileSync(USER_LIST).toString(),

			writeToLog = function(ev){
				var logText = [ev.time, ev.uid, ev.type].join(",");

				return fs.appendFileSync(LOG_FILE, logText + "\n");
			},

			users = {
				index : {},
				raw : []
			};

			userList.trim().split("\n").forEach(function(row){
				var parts = row.trim().split(","),
				uid = parts.shift(),
				fullname = parts.shift(),
				user = new User(uid, fullname);

				users.raw.push(user);
				users.index[uid] = user;
			});

			return {
				getUsers : function(){ return users.raw; },
				logEvent : function(ev){
					var user = users.index[ev.uid],
					evType = parseInt(ev.type, 10);

					if(typeof user === typeof undefined){
						// Invalid uid
						return false;
					}

					if(isNaN(evType)){
						// Invalid event
						return false;
					}

					if(typeof ev.psk !== typeof "" || ev.psk !== PSK2){
						// Wrong PSK
						return false;
					}

					(function(){
						var event = new Event(user.uid, evType);

						writeToLog(event);

						user.updated = event.time;
						user.status = event.type;
					})();

					return true;
				}
			};
		};

		(function(){
			var journal = new Journal(),

			wscs = [],
			mcastUsers = function(){
				var usersJSON = JSON.stringify(journal.getUsers());

				wscs.forEach(function(ws){
					ws.send(usersJSON);
				});
			},

			logStat = function(){
				var LogUser = function(username){
					return {
						username : username,
						status : 0,
						lastIn : NaN,
						lastOut : NaN,
						lastUpdated : NaN,
						workTime : 0
					};
				},
				logUsers = {},
				logString = fs.readFileSync(LOG_FILE).toString().trim();

				if(logString.length > 0){
					logString.split("\n").forEach(function(line){
						var values = line.trim().split(","),
						evTime = parseInt(values[0], 10),
						evType = parseInt(values[2], 10),
						user = typeof logUsers[values[1]] !== typeof undefined ? logUsers[values[1]] : logUsers[values[1]] = new LogUser(values[1]);

						switch(evType){
							case 0:
								user.lastOut = evTime;

								if(user.status !== 0){
									user.workTime += user.lastOut - user.lastIn;
								}

								break;

							case 1:
							case 2:
							case 3:
								if(user.status === 0){
									user.lastIn = evTime;
								}

								break;
						}

						user.status = evType;
						user.lastUpdated = evTime;
					});
				}

				return (function(){
					var usersRanked = [],
					iUsername = "",

					ret = [];

					for(iUsername in logUsers){
						if(logUsers.hasOwnProperty(iUsername)){
							usersRanked.push({
								username : logUsers[iUsername].username,
								status : logUsers[iUsername].status,
								lastIn : !isNaN(logUsers[iUsername].lastIn) ? new Date(logUsers[iUsername].lastIn).toString() : "Never",
								lastOut : !isNaN(logUsers[iUsername].lastOut) ? new Date(logUsers[iUsername].lastOut).toString() : "Never",
								workTime : Math.round(logUsers[iUsername].workTime / 1000 / 60)
							});
						}
					}

					usersRanked.sort(function(a, b){
						return b.workTime - a.workTime;
					});

					ret.push(["Username", "Last In", "Last Out", "Worktime"].join(","));
					usersRanked.forEach(function(user){
						ret.push([user.username, user.lastIn, user.lastOut, user.workTime].join(","));
					});

					return ret.join("\n");
				})();
			},

			httpd = new https.createServer({
				key : fs.readFileSync(SSL_KEY),
				cert : fs.readFileSync(SSL_CERT)
			}),

			wss = new ws.Server({
				server : httpd,
				path : "/" + PSK1
			});

			fs.appendFileSync(LOG_FILE, "");

			httpd.on("request", function(req, res){
				if(req.url === "/stat"){
					res.writeHead(200, {"Content-Type" : "text/plain; charset=UTF-8"});
					res.write(logStat());
				}else if(req.url === "/log"){
					res.writeHead(200, {"Content-Type" : "text/plain; charset=UTF-8"});
					res.write(fs.readFileSync(LOG_FILE));
				}else{
					res.writeHead(200, {"Content-Type" : "text/html; charset=UTF-8"});
					res.write(fs.readFileSync(CLI_HTML));
				}
				res.end();
			});

			httpd.listen(SRV_PORT, "::");
			httpd.listen(SRV_PORT, "0.0.0.0");

			wss.on("connection", function(ws){
				var sendUsers = function(){
					ws.send(JSON.stringify(journal.getUsers()));
				},

				feeder = setInterval(sendUsers, PING_INTERVAL);

				ws.on("message", function(m){
					try{
						journal.logEvent(JSON.parse(m));
					}catch(e){
					}
				});

				ws.on("message", mcastUsers);

				ws.on("close", function(){
					wscs.splice(wscs.indexOf(ws), 1);
					clearInterval(feeder);
				});

				sendUsers();
				wscs.push(ws);
			});
		})();
	})();
})();
