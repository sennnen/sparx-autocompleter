import { Sparx } from "./classes/Sparx.js";
import { getSchools } from "./classes/School.js";

import dotenv from "dotenv";
dotenv.config();

import readline from "node:readline";
import fs from "node:fs";

function loadingAnimation(
    text = "",
    chars = ["⠙", "⠘", "⠰", "⠴", "⠤", "⠦", "⠆", "⠃", "⠋", "⠉"],
    delay = 100
) {
    let x = 0;

    return setInterval(function() {
        process.stdout.write("\r" + text + " " + chars[x++] + "\x1b[0m");
        x = x % chars.length;
    }, delay);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

async function getInput(question) {
    return await new Promise(resolve => {
        rl.question(question, answer => {
            resolve(answer);
        });
    });
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

(async () => {
    const schoolsLoader = loadingAnimation("Fetching schools:");
    const schools = await getSchools();
    clearInterval(schoolsLoader);
    process.stdout.write("\r\x1b[32mFetching schools: ✓\x1b[0m\n");

    let client;

    const username = process.env.SPARX_USERNAME;
    const password = process.env.SPARX_PASSWORD;
    const schoolName = process.env.SPARX_SCHOOL;

    if (username && password && schoolName) {
        const school = schools.find(school => school.name.toLowerCase() === schoolName.toLowerCase());

        if (!school) {
            console.log("Invalid school.");
            process.exit(1);
        }

        client = new Sparx(username, password, school);
    } else if (process.env.SPARX_TOKENS) {
        client = new Sparx(null, null, null, JSON.parse(Buffer.from(process.env.SPARX_TOKENS, "base64").toString("utf-8")));
    } else {
        console.log("Please provide the following environment variables:");
        console.log("- SPARX_USERNAME");
        console.log("- SPARX_PASSWORD");
        console.log("- SPARX_SCHOOL");
        // console.log("OR");
        // console.log("- SPARX_TOKENS");
        process.exit(1);
    }


    process.on("uncaughtException", async error => {
        console.error(error);
        
        try {
            await client.logout();
        } catch (error) {
            console.error(error);
        }

        process.exit(1);
    });

    const loginLoader = loadingAnimation("Logging in:");

    try {
        await client.login();
    } catch (error) {
        clearInterval(loginLoader);
        process.stdout.write("\r\x1b[31mLogging in: ×\x1b[0m\n");
        console.error(error);
        process.exit(1);   
    }
    
    clearInterval(loginLoader);
    process.stdout.write("\r\x1b[32mLogging in: ✓\x1b[0m\n");

    const homeworks = await client.getHomeworks();

    console.log('=========================================');
    for (let i = 0; i < homeworks.length; i++) {
        console.log(`${i + 1}. ${homeworks[i].name}`);
    }
    console.log('=========================================');

    let homeworkIndex = null;
    while (homeworkIndex === null) {
        const answer = await getInput("Select number: ");
        if (isNaN(parseInt(answer)) || parseInt(answer) < 1 || parseInt(answer) > homeworks.length) {
            console.log("Invalid number.");
            continue;
        }

        homeworkIndex = parseInt(answer) - 1;
    }

    const homework = homeworks[homeworkIndex];

    console.log(`\nCompleting homework "${homework.name}"...\n`);

    const tasks = await homework.getTasks();

    console.log(`Tasks to complete: ${tasks.length}`);

    let amountOfTasksCompleted = 0;

    for (let i = 0; i < tasks.length; i++) {
        console.log('\n' + tasks[i].name);

        const taskActivitiesMeta = await tasks[i].getActivities();

        for (let j = 0; j < tasks[i].totalAmountOfQuestions; j++) {
            if (taskActivitiesMeta[j].completed) {
                console.log(`  ${j + 1}. \x1b[32m✓\x1b[0m`);
                continue;
            }

            const loader = loadingAnimation(`  ${j + 1}.`);

            const activity = await tasks[i].getActivity(j + 1);
            await activity.registerStart();
            const answers = await activity.getAnswers(j);

            if (!answers) {
                clearInterval(loader);
                process.stdout.write(`\r  ${j + 1}. \x1b[31m×\x1b[0m\n`);
                continue;
            }

            const submissionSuccess = await activity.submitAnswers(answers);

            if (submissionSuccess) {
                clearInterval(loader);
                process.stdout.write(`\r  ${j + 1}. \x1b[32m✓\x1b[0m\n`);
                
                amountOfTasksCompleted++;

                if (!fs.existsSync("bookwork")) {
                    fs.mkdirSync("bookwork");
                }

                const existingBookworkJson = fs.existsSync(`bookwork/${homework.name.replace(/\s/g, "-")}.json`) ? JSON.parse(fs.readFileSync(`bookwork/${homework.name.replace(/\s/g, "-")}.json`)) : {};

                existingBookworkJson[`${i + 1}${alphabet[j]}`] = answers;

                fs.writeFileSync(`bookwork/${homework.name.replace(/\s/g, "-")}.json`, JSON.stringify(existingBookworkJson, null, 4));
            } else {
                // console.log(answers);
                // console.log(JSON.stringify(activity.layout));

                clearInterval(loader);
                process.stdout.write(`\r  ${j + 1}. \x1b[31m×\x1b[0m\n`);
            }
        }
    }

    const newTotalAmountCompleted = homework.completedAmountOfQuestions + amountOfTasksCompleted;

    const oldPercentage = Math.round((homework.completedAmountOfQuestions / homework.totalAmountOfQuestions) * 100);
    const newPercentage = Math.round((newTotalAmountCompleted / homework.totalAmountOfQuestions) * 100);

    console.log(`\n\x1b[31m${oldPercentage}% \x1b[0m-> \x1b[32m${newPercentage}%\x1b[0m`);

    await client.logout();

    process.exit(0);
})();