import { Sparx } from "./classes/Sparx.js";
import { School, getSchools } from "./classes/School.js";
import { encodeProto, TYPES } from "./classes/Protobuf.js";

import dotenv from "dotenv";
dotenv.config();

import readline from "node:readline";

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

// (async () => {
//     const bodyProto = [
//         {
//             index: 2,
//             type: TYPES.LENDELIM,
//             value: [
//                 {
//                     index: 1,
//                     type: TYPES.LENDELIM,
//                     value: "5f7c0c53-0130-44fb-b718-56d83b27bd1e",
//                 },
//                 {
//                     index: 2,
//                     type: TYPES.VARINT,
//                     value: 4,
//                 },
//                 {
//                     index: 3,
//                     type: TYPES.VARINT,
//                     value: 4,
//                 }
//             ],
//         },
//         {
//             index: 4,
//             type: TYPES.LENDELIM,
//             value: [
//                 {
//                     index: 1,
//                     type: TYPES.VARINT,
//                     value: Math.floor(new Date(Date.now() - Math.random() * 6 * 60000) / 1000),
//                 },
//                 {
//                     index: 2,
//                     type: TYPES.VARINT,
//                     value: 632000000,
//                 }
//             ],
//         }
//     ];
//     const encodedBody = Buffer.concat([Buffer.alloc(4), Buffer.alloc(1, 58), encodeProto(bodyProto)]);
//     console.log(encodedBody.toString('base64'));
// })();

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

(async () => {
    const schoolsLoader = loadingAnimation("Fetching schools:");
    const schools = await getSchools();
    clearInterval(schoolsLoader);
    process.stdout.write("\r\x1b[32mFetching schools: ✓\x1b[0m\n");

    const username = process.env.SPARX_USERNAME;
    const password = process.env.SPARX_PASSWORD;
    const schoolName = process.env.SPARX_SCHOOL;

    const school = schools.find(school => school.name.toLowerCase() === schoolName.toLowerCase());

    const client = new Sparx(username, password, school);

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