(function(){
	"use strict";

	var PSK1 = "",
	PSK2 = "",
	USER_LIST = "users.csv",
	CLI_HTML = "cli.html",
	DUMP_FILE = "dump.json",
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
			var users = {
				index : {},
				raw : []
			};

			(function(){
				if(!fs.existsSync(DUMP_FILE)){
					fs.writeFileSync(DUMP_FILE, JSON.stringify({}));
				}
			})();

			(function(){
				var userList = fs.readFileSync(USER_LIST).toString(),
				dumpState = JSON.parse(fs.readFileSync(DUMP_FILE).toString());

				userList.trim().split("\n").forEach(function(row){
					var parts = row.trim().split(","),
					uid = parts.shift(),
					fullname = parts.shift(),
					user = new User(uid, fullname);

					users.raw.push(user);
					users.index[uid] = user;

					if(dumpState[user.uid] !== undefined){
						user.status = dumpState[user.uid].status;
						user.updated = dumpState[user.uid].updated;
					}
				});
			})();

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

						user.updated = event.time;
						user.status = event.type;

						fs.writeFileSync(DUMP_FILE, JSON.stringify(users.index));
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

			httpd = new https.createServer({
				key : fs.readFileSync(SSL_KEY),
				cert : fs.readFileSync(SSL_CERT)
			}),

			wss = new ws.Server({
				server : httpd,
				path : "/" + PSK1
			});

			httpd.on("request", function(req, res){
				res.writeHead(200, {"Content-Type" : "text/html; charset=UTF-8"});
				res.write(fs.readFileSync(CLI_HTML));
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
