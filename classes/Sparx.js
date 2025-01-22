import { JSDOM } from "jsdom";
import { HttpProxyAgent } from 'http-proxy-agent';
import fetch from 'node-fetch';
import randUserAgent from "rand-user-agent";

import { SparxLogin } from "./SparxLogin.js";
import { School } from "./School.js";
import { Homework, HomeworkTask } from "./Homework.js";
import { Activity } from "./Activity.js";
import { Cloudflare } from "./Cloudflare.js";
import { decodeProtoRecursive, TYPES, encodeProto } from "./Protobuf.js";

/** Represents a Sparx client. */
class Sparx {
    /**
     * Create a Sparx client.
     * 
     * @param {string} username - The username of the client
     * @param {string} password - The password of the client
     * @param {School} school - The school of the client
     */
    constructor(username, password, school, cookies) {
        if ((!username || !password || !school) && !cookies) {
            throw new TypeError("You must provide a username, password, and school OR cookies.");
        }

        this.username = username;
        this.password = password;
        this.school = school;
        this.usesCookies = false;

        if (cookies) {
            this.cookies = cookies;
            this.usesCookies = true;
        } else {
            this.cookies = {
                'live-resolver-school': this.school.slug,
                'cookie_preferences': '{"GA":false,"Hotjar":false,"PT":false,"version":4}',
            };
        }

        this.token = null;
        this.sessionId = null;

        this.agent = process.env.PROXY_URL ? new HttpProxyAgent(process.env.PROXY_URL) : null;
    }

    /** Set cookies from response. */
    _setCookies(response) {
        const cookies = response.headers.raw()['set-cookie'];

        if (!cookies) return;

        for (const cookie of cookies) {
            const [name, value] = cookie.split(';')[0].split("=");
            this.cookies[name] = value;
        }
    }

    /** Get cookies. */
    _getCookies() {
        return Object.entries(this.cookies).map(([name, value]) => `${name}=${value}`).join("; ");
    }

    /** Get the OAuth request URL. */
    async _getOauthRequestUrl() {
        const dashboardRequestUrl = `https://www.sparxmaths.uk/student/?s=${this.school.slug}`;
        this.cookies['live-resolver-school'] = this.school.slug;

        const dashboardResponse = await fetch(
            dashboardRequestUrl,
            {
                method: "GET",
                headers: {
                    "Cookie": this._getCookies(),
                    "User-Agent": randUserAgent('desktop', 'chrome', 'windows'),
                },
            }
        );

        if (!dashboardResponse.redirected) {
            throw new Error("Failed to get OAuth request URL.");
        }

        this._setCookies(dashboardResponse);

        return dashboardResponse.url;
    }

    /** Refresh the token. */
    async _refreshToken() {
        const tokenRequestUrl = 'https://studentapi.api.sparxmaths.uk/accesstoken';

        const tokenResponse = await fetch(
            tokenRequestUrl,
            {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Cookie": this._getCookies(),
                    "X-CSRF-TOKEN": this.cookies["sparxweb_csrf"],
                },
                credentials: "include",
            }
        );
        
        if (tokenResponse.status !== 200) {
            throw new Error("Failed to refresh token.");
        }

        const token = await tokenResponse.text();
        this.token = token;


        const sessionRequestUrl = 'https://studentapi.api.sparxmaths.uk/clientsession';

        const sessionResponse = await fetch(
            sessionRequestUrl,
            {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Cookie": this._getCookies(),
                    "X-CSRF-TOKEN": this.cookies["sparxweb_csrf"],
                    "Origin": "https://www.sparxmaths.uk/",
                    "User-Agent": randUserAgent('desktop'),
                },
                credentials: "include",
            }
        );

        if (sessionResponse.status !== 200) {
            throw new Error("Failed to get session ID.");
        }

        const sessionInfo = await sessionResponse.json();
        this.sessionId = sessionInfo.sessionID;
    }

    /** Perform the OAuth flow. */
    async _performOauthFlow(oauthRequestUrl) {
        const oauthHtmlPageResponse = await fetch(
            oauthRequestUrl,
            {
                method: "GET",
                headers: {
                    "Cookie": this._getCookies()
                },
            }
        );

        this._setCookies(oauthHtmlPageResponse);
        
        const oauthHtmlPage = await oauthHtmlPageResponse.text();
        const dom = new JSDOM(oauthHtmlPage);
        const domain = dom.window.document.querySelector("input[name='domain']").value;
        const domainTitle = dom.window.document.querySelector("input[name='domainTitle']").value;
        const gorillaCsrfToken = dom.window.document.querySelector("input[name='gorilla.csrf.Token']").value;

        const oauthResponse = await fetch(
            oauthRequestUrl,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cookie": this._getCookies(),
                    "Origin": "https://auth.sparxmaths.uk/",
                    "Priority": "u=0, i",
                    "User-Agent": randUserAgent('desktop'),
                },
                body: new URLSearchParams({
                    username: this.username,
                    password: this.password,
                    domain: domain,
                    domainTitle: domainTitle,
                    "gorilla.csrf.Token": gorillaCsrfToken,
                }),
                credentials: "include",
                redirect: "manual",
            }
        );

        if (oauthResponse.status !== 303) {
            throw new Error("Failed to login on initial request.");
        }
        if (oauthResponse.headers.get("Location").startsWith("/oauth2/error")) {
            throw new Error("Failed to login on initial request due to invalid credentials.");
        }

        this._setCookies(oauthResponse);

        const oauthCallbackUrl = new URL(oauthResponse.headers.get("Location"));

        const oauthCallbackResponse = await fetch(
            oauthCallbackUrl,
            {
                method: "GET",
                headers: {
                    "Cookie": this._getCookies()
                },
                redirect: "manual",
            }
        );

        if (oauthCallbackResponse.status !== 302) {
            throw new Error("Failed to login on callback.");
        }

        this._setCookies(oauthCallbackResponse);

        const dashboardRequestUrl = `https://www.sparxmaths.uk/student/?s=${this.school.slug}`;
        const dashboardResponse = await fetch(
            dashboardRequestUrl,
            {
                method: "GET",
                headers: {
                    "Cookie": this._getCookies()
                },
                redirect: "follow",
            }
        );

        if (dashboardResponse.url.includes('/oauth2/auth')) {
            throw new Error("Failed to login due to unexpected error.");
        }
    }

    /** Login to Sparx. */
    async login() {
        if (!this.usesCookies) {
            const oauthRequestUrl = await this._getOauthRequestUrl();
            await this._performOauthFlow(oauthRequestUrl);
        }

        await this._refreshToken();
    }

    async logout() {
        const logoutRequestUrl = 'https://studentapi.api.sparxmaths.uk/oauth2/logout';

        const logoutResponse = await fetch(
            logoutRequestUrl,
            {
                method: "POST",
                headers: {
                    "Cookie": this._getCookies(),
                    "Content-Type": "application/grpc-web+proto",
                },
                credentials: "include",
            }
        );

        if (logoutResponse.status !== 200) {
            throw new Error("Failed to logout.");
        }
    }

    async getHomeworks() {
        const homeworkTasksRequestUrl = `https://studentapi.api.sparxmaths.uk/sparx.swworker.v1.Sparxweb/GetPackageData`;
        const bodyBuffer = Buffer.from('AAAAAAQQARgB', 'base64');

        const homeworkTasksResponse = await fetch(
            homeworkTasksRequestUrl,
            {
                method: "POST",
                headers: {
                    "Authorization": this.token,
                    "Cookie": this._getCookies(),
                    "Content-Type": "application/grpc-web+proto",
                    "x-grpc-web": "1",
                    "x-server-offset": "0",
                    "x-session-id": this.sessionId,
                },
                body: bodyBuffer,
            }
        );
        
        if (homeworkTasksResponse.status !== 200) {
            throw new Error("Failed to get homeworks.");
        }

        if (homeworkTasksResponse.headers.get("grpc-status") !== null) {
            throw new Error("Failed to get homeworks with status " + homeworkTasksResponse.headers.get("grpc-status"));
        }

        const homeworkTasks = await homeworkTasksResponse.blob();
        const completeDecodedProto = decodeProtoRecursive(Buffer.from(await homeworkTasks.arrayBuffer()));

        const homeworks = [];
        
        for (const sPackage of completeDecodedProto) {
            /** @type {any[]} */
            const packageValue = sPackage.value;
            
            if (!Array.isArray(packageValue)) continue;
            // if (packageValue.find(value => value.index == 5)?.value != 'homework') continue;

            const homework = new Homework(
                this,
                packageValue.find(value => value.index === 1).value,
                new Date(parseInt(packageValue.find(value => value.index === 2).value[0].value) * 1000),
                new Date(parseInt(packageValue.find(value => value.index === 3).value[0].value) * 1000),
                packageValue.find(value => value.index === 4).value,
                parseInt(packageValue.find(value => value.index === 6)?.value),
                parseInt(packageValue.find(value => value.index === 7)?.value),
                parseInt(packageValue.find(value => value.index === 8)?.value),
                parseInt(packageValue.find(value => value.index === 9)?.value),
                parseInt(packageValue.find(value => value.index === 10)?.value),
            );

            homeworks.push(homework);
        }

        homeworks.sort((a, b) => a.dueDate - b.dueDate);

        return homeworks;
    }

    async getHomeworkTasks(homeworkId) {
        const b64HomeworkId = Buffer.from(homeworkId).toString('base64');

        const homeworkTasksRequestUrl = `https://studentapi.api.sparxmaths.uk/sparx.swworker.v1.Sparxweb/GetPackageData`;
        const bodyBuffer = Buffer.from('AAAAACggATIk' + b64HomeworkId, 'base64');

        const homeworkTasksResponse = await fetch(
            homeworkTasksRequestUrl,
            {
                method: "POST",
                headers: {
                    "Authorization": this.token,
                    "Cookie": this._getCookies(),
                    "Content-Type": "application/grpc-web+proto",
                    "x-grpc-web": "1",
                    "x-server-offset": "0",
                    "x-session-id": this.sessionId,
                },
                body: bodyBuffer,
            }
        );
        
        if (homeworkTasksResponse.status !== 200) {
            throw new Error("Failed to get homework tasks.");
        }

        if (homeworkTasksResponse.headers.get("grpc-status") !== null) {
            throw new Error("Failed to get homework tasks with status " + homeworkTasksResponse.headers.get("grpc-status"));
        }

        const homeworkTasks = await homeworkTasksResponse.blob();
        const completeDecodedProto = decodeProtoRecursive(Buffer.from(await homeworkTasks.arrayBuffer()));

        const tasks = [];
        
        for (const sTask of completeDecodedProto) {
            if (sTask.index !== 2) continue;

            /** @type {any[]} */
            const taskValue = sTask.value;
            
            if (!Array.isArray(taskValue)) continue;

            const task = new HomeworkTask(
                this,
                taskValue.find(value => value.index === 1).value,
                parseInt(taskValue.find(value => value.index === 2).value),
                taskValue.find(value => value.index === 3).value,
                parseInt(taskValue.find(value => value.index === 6)?.value),
                parseInt(taskValue.find(value => value.index === 7)?.value),
                taskValue.find(value => value.index === 8)?.value == '1',
            );

            tasks.push(task);
        }

        return tasks;
    }

    async getTaskActivities(packageId, taskIndex) {
        const bodyProto = [
            {
                index: 5,
                type: TYPES.VARINT,
                value: 1,
            },
            {
                index: 6,
                type: TYPES.LENDELIM,
                value: packageId,
            },
            {
                index: 7,
                type: TYPES.VARINT,
                value: taskIndex,
            },
        ];
        const encodedBody = encodeProto(bodyProto);
        const headerBuffer = Buffer.alloc(5);
        headerBuffer.writeUInt32BE(encodedBody.length, 1);
        const fullBuffer = Buffer.concat([headerBuffer, encodedBody]);

        const homeworkTasksRequestUrl = `https://studentapi.api.sparxmaths.uk/sparx.swworker.v1.Sparxweb/GetPackageData`;

        const homeworkTasksResponse = await fetch(
            homeworkTasksRequestUrl,
            {
                method: "POST",
                headers: {
                    "Authorization": this.token,
                    "Cookie": this._getCookies(),
                    "Content-Type": "application/grpc-web+proto",
                    "x-grpc-web": "1",
                    "x-server-offset": "0",
                    "x-session-id": this.sessionId,
                },
                body: fullBuffer,
            }
        );

        if (homeworkTasksResponse.status !== 200) {
            throw new Error("Failed to get homework tasks.");
        }

        if (homeworkTasksResponse.headers.get("grpc-status") !== null) {
            throw new Error("Failed to get homework tasks with status " + homeworkTasksResponse.headers.get("grpc-status"));
        }

        const homeworkTasks = await homeworkTasksResponse.blob();
        const completeDecodedProto = decodeProtoRecursive(Buffer.from(await homeworkTasks.arrayBuffer()));

        const activityMeta = [];
        
        for (const sTask of completeDecodedProto) {
            if (sTask.index !== 3) continue;

            /** @type {any[]} */
            const taskValue = sTask.value;
            
            if (!Array.isArray(taskValue)) continue;

            const meta = {
                activityIndex: parseInt(taskValue.find(value => value.index === 3)?.value),
                completed: parseInt(taskValue.find(value => value.index === 4)?.value) == 1,
                name: taskValue.find(value => value.index === 9)?.value,
            };

            activityMeta.push(meta);
        }

        return activityMeta;
    }

    async getActivity(packageId, taskIndex, activityIndex) {
        const timestamp = new Date(Date.now() - Math.random() * 6 * 60000);
        const bodyProto = [
            {
                index: 2,
                type: TYPES.LENDELIM,
                value: [
                    {
                        index: 1,
                        type: TYPES.LENDELIM,
                        value: packageId,
                    },
                    {
                        index: 2,
                        type: TYPES.VARINT,
                        value: taskIndex,
                    },
                    {
                        index: 3,
                        type: TYPES.VARINT,
                        value: activityIndex,
                    }
                ],
            },
            {
                index: 4,
                type: TYPES.LENDELIM,
                value: [
                    {
                        index: 1,
                        type: TYPES.VARINT,
                        value: Math.floor(timestamp / 1000),
                    },
                    {
                        index: 2,
                        type: TYPES.VARINT,
                        value: timestamp.getMilliseconds() * 1000000,
                    }
                ],
            }
        ];
        const encodedBody = encodeProto(bodyProto);
        const headerBuffer = Buffer.alloc(5);
        headerBuffer.writeUInt32BE(encodedBody.length, 1);
        const fullBuffer = Buffer.concat([headerBuffer, encodedBody]);

        const activitiesRequestUrl = `https://studentapi.api.sparxmaths.uk/sparx.swworker.v1.Sparxweb/GetActivity`;

        const activitiesResponse = await fetch(
            activitiesRequestUrl,
            {
                method: "POST",
                headers: {
                    "Authorization": this.token,
                    "Cookie": this._getCookies(),
                    "Content-Type": "application/grpc-web+proto",
                    "x-grpc-web": "1",
                    "x-server-offset": "0",
                    "x-session-id": this.sessionId,
                },
                body: fullBuffer,
            }
        );
        
        if (activitiesResponse.status !== 200) {
            throw new Error("Failed to get homework tasks.");
        }

        if (activitiesResponse.headers.get("grpc-status") !== null) {
            if (activitiesResponse.headers.get("grpc-status") == '9') {
                throw new Error("Autocompleter stopped because bookwork check required.");
                // TODO: Implement auto bookwork check
                // GetActivity & ActivityAction again for BW check
            }

            throw new Error("Failed to get homework tasks with status " + activitiesResponse.headers.get("grpc-status"));
        }

        const activity = await activitiesResponse.blob();
        const completeDecodedProto = decodeProtoRecursive(Buffer.from(await activity.arrayBuffer()));
        const infoValue = completeDecodedProto.find(value => value.index === 3).value;

        const activityObj = new Activity(
            this,
            taskIndex,
            parseInt(completeDecodedProto.find(value => value.index === 1).value),
            infoValue.find(value => value.index === 2)?.value,
            infoValue.find(value => value.index === 4)?.value,
            JSON.parse(infoValue.find(value => value.index === 3)?.value),
        );

        return activityObj;
    }

    async registerActivityStart(activityIndex) {
        const timestamp = new Date(Date.now() - Math.random() * 6 * 60000);
        const bodyProto = [
            {
                index: 1,
                type: TYPES.VARINT,
                value: activityIndex,
            },
            {
                index: 2,
                type: TYPES.LENDELIM,
                value: [
                    {
                        index: 1,
                        type: TYPES.VARINT,
                        value: Math.floor(timestamp / 1000),
                    },
                    {
                        index: 2,
                        type: TYPES.VARINT,
                        value: timestamp.getMilliseconds() * 1000000,
                    }
                ],
            },
            {
                index: 4,
                type: TYPES.LENDELIM,
                value: [
                    {
                        index: 1,
                        type: TYPES.VARINT,
                        value: activityIndex,
                    },
                ],
            }
        ];
        const encodedBody = encodeProto(bodyProto);
        const headerBuffer = Buffer.alloc(5);
        headerBuffer.writeUInt32BE(encodedBody.length, 1);
        const fullBuffer = Buffer.concat([headerBuffer, encodedBody]);

        const registerRequestUrl = `https://studentapi.api.sparxmaths.uk/sparx.swworker.v1.Sparxweb/ActivityAction`;

        const registerResponse = await fetch(
            registerRequestUrl,
            {
                method: "POST",
                headers: {
                    "Authorization": this.token,
                    "Cookie": this._getCookies(),
                    "Content-Type": "application/grpc-web+proto",
                    "x-grpc-web": "1",
                    "x-server-offset": "0",
                    "x-session-id": this.sessionId,
                },
                body: fullBuffer,
            }
        );

        if (registerResponse.status !== 200) {
            throw new Error("Failed to register activity start.");
        }

        if (registerResponse.headers.get("grpc-status") !== null) {
            throw new Error("Failed to register activity start with status " + registerResponse.headers.get("grpc-status"));
        }
    }

    async submitAnswer(activityIndex, answers) {
        const timestamp = new Date(Date.now());

        const answersProto = [];
        for (const [key, value] of Object.entries(answers)) {
            answersProto.push({
                index: 1,
                type: TYPES.LENDELIM,
                value: [
                    {
                        index: 1,
                        type: TYPES.LENDELIM,
                        value: key.toString(),
                    },
                    {
                        index: 2,
                        type: TYPES.LENDELIM,
                        value: value.toString(),
                    }
                ],
            });
        }

        const bodyProto = [
            {
                index: 1,
                type: TYPES.VARINT,
                value: activityIndex,
            },
            {
                index: 2,
                type: TYPES.LENDELIM,
                value: [
                    {
                        index: 1,
                        type: TYPES.VARINT,
                        value: Math.floor(timestamp.getTime() / 1000),
                    },
                    {
                        index: 2,
                        type: TYPES.VARINT,
                        value: timestamp.getMilliseconds() * 1000000,
                    }
                ],
            },
            {
                index: 4,
                type: TYPES.LENDELIM,
                value: [
                    {
                        index: 1,
                        type: TYPES.VARINT,
                        value: activityIndex,
                    },
                    {
                        index: 3,
                        type: TYPES.VARINT,
                        value: 1,
                    },
                    {
                        index: 4,
                        type: TYPES.LENDELIM,
                        value: answersProto,
                    },
                ],
            }
        ];
        const encodedBody = encodeProto(bodyProto);
        const headerBuffer = Buffer.alloc(5);
        headerBuffer.writeUInt32BE(encodedBody.length, 1);
        const fullBuffer = Buffer.concat([headerBuffer, encodedBody]);
        // console.log(fullBuffer.toString('base64'));

        const answerRequestUrl = `https://studentapi.api.sparxmaths.uk/sparx.swworker.v1.Sparxweb/ActivityAction`;

        const answerResponse = await fetch(
            answerRequestUrl,
            {
                method: "POST",
                headers: {
                    "Authorization": this.token,
                    "Cookie": this._getCookies(),
                    "Content-Type": "application/grpc-web+proto",
                    "x-grpc-web": "1",
                    "x-server-offset": "0",
                    "x-session-id": this.sessionId,
                },
                body: fullBuffer,
            }
        );

        if (answerResponse.status !== 200) {
            throw new Error("Failed to submit answer.");
        }

        if (answerResponse.headers.get("grpc-status") !== null) {
            throw new Error("Failed to submit answer with status " + answerResponse.headers.get("grpc-status"));
        }

        const answer = await answerResponse.blob();
        const completeDecodedProto = decodeProtoRecursive(Buffer.from(await answer.arrayBuffer()));
        // console.log(Buffer.from(await answer.arrayBuffer()).toString('base64'));

        return completeDecodedProto.find(value => value.index === 1).value.includes('SUCCESS');
    }
}

export { Sparx };