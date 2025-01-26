import { Sparx } from "./Sparx.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import vm from "vm";

/** Class representing an Activity. */
class Activity {
    /**
     * Create an Activity.
     * 
     * @param {Sparx} sparxClient - The Sparx client
     * @param {number} taskIndex - The index of the task
     * @param {number} activityIndex - The index of the activity
     * @param {string} id - The ID of the activity
     * @param {string} code - The code of the activity
     * @param {object} layout - The layout of the activity
     */
    constructor(
        sparxClient,
        taskIndex,
        activityIndex,
        id,
        code,
        layout
    ) {
        this.client = sparxClient;
        this.taskIndex = taskIndex;
        this.activityIndex = activityIndex;
        this.id = id;
        this.code = code;
        this.layout = layout;
    }

    async registerStart() {
        return this.client.registerActivityStart(this.activityIndex);
    }

    async getAnswers() {
        // if (this.layout[0].layout.type.includes("multiple-choice") || this.layout[0].layout.type.includes("multi-part")) {
        //     // This quesion is a multiple choice question
        //     const answers = calculateMultipleChoiceAnswer(this.layout[0]);
        //     if (answers) {
        //         return answers;
        //     }
        // }

        const question = this.layout[0].layout.content[0].content[0].content[0].text;

        let imageUrl;
        if (this.layout[0].layout.content[0].content.length >= 2 && this.layout[0].layout.content[0].content[1].type.includes("question-image")) {
            imageUrl = "https://assets.sparxhomework.uk/" + this.layout[0].layout.content[0].content[1].figure.image;
        }

        const numberFieldIds = Object.keys(this.layout[0].input.number_fields);

        const results = await getAnswerFromAI(question, this.layout[0], numberFieldIds.length, imageUrl);
        if (results.length === 0) return;

        const answers = {};

        for (const result of results) {
            answers[result.id] = result.answer;
        }

        return answers;
    }

    async submitAnswers(homework, answers, bookworkCode) {
        return this.client.submitAnswer(homework, this.activityIndex, answers, bookworkCode);
    }
}

/** Calculate the answer for a multiple choice question. */
function calculateMultipleChoiceAnswer(layoutInfo) {
    const answerIds = [];

    if (layoutInfo.input.choice_groups.choice_group) {
        if (layoutInfo.input.choice_groups.choice_group.max_choices && layoutInfo.input.choice_groups.choice_group.max_choices !== 1) return;
        answerIds.push(layoutInfo.input.choice_groups.choice_group.choice_refs[0]);
    } else {
        const acceptCounts = {};
        for (const answerContent of layoutInfo.layout.content[1].content[0].content) {
            if (!answerContent.type.includes("answer-part")) continue;

            for (const answerPartContent of answerContent.content) {
                if (answerPartContent.element !== "slot") continue;

                if (acceptCounts[answerPartContent.accept]) {
                    acceptCounts[answerPartContent.accept] += 1;
                } else {
                    acceptCounts[answerPartContent.accept] = 1;
                }
            }
        }

        for (const acceptKey of Object.keys(acceptCounts)) {
            const cardGroupKey = Object.keys(layoutInfo.input.card_groups).find(cardGroupKeSearch => cardGroupKeSearch === acceptKey);
            if (!cardGroupKey) continue;

            const cardGroup = layoutInfo.input.card_groups[cardGroupKey];

            for (let i = 0; i < acceptCounts[acceptKey]; i++) {
                answerIds.push(cardGroup.card_refs[i]);
            }
        }
    }

    const answers = {};

    for (const answerId of answerIds) {
        let slotId;
        for (const [cardGroupId, cardGroupData] of Object.entries(layoutInfo.input.card_groups)) {
            if (cardGroupData.card_refs.includes(answerId)) {
                slotId = cardGroupId;
                break;
            }
        }

        let answerContent;
        if (layoutInfo.input.cards[answerId]) {
            answerContent = layoutInfo.input.cards[answerId].content[0].text;
        } else if (layoutInfo.input.choices[answerId]) {
            answerContent = layoutInfo.input.choices[answerId].content[0].text;
        }

        if (slotId) {
            answers[slotId] = answerId;
        } else {
            answers[answerId] = answerContent;
        }
    }

    return Object.keys(answers).length > 0 ? answers : null;
}

/** 
 * Get an answer from the AI.
 * 
 * @param {string} question - The question
 * @param {object} layoutInfo - The layout information
 * @param {number} outputLength - The required output length
 * @param {string} imageUrl - The image URL
 */
async function getAnswerFromAI(question, layoutInfo, outputLength, imageUrl) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash-thinking-exp-01-21",
        generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            topK: 64,
            maxOutputTokens: 65536,
            responseMimeType: "text/plain",
        },
        tools: [{codeExecution: {}}],
    });
    
    let answerObject;
    let answerScreenType;
    if (layoutInfo.layout.type.includes("free-answer")) {
        answerObject = layoutInfo.layout.content[1].content[0];
        answerScreenType = "number-field";
    } else if (layoutInfo.layout.content.find(content => content.type.includes("answer"))) {
        const answerContent = layoutInfo.layout.content.find(content => content.type.includes("answer"));

        const answerScreenCheck = answerContent.content.find(content => {
            if (!content.type) return false;
            return content.type.includes("answer-screen");
        });
        if (answerScreenCheck) {
            answerObject = answerScreenCheck;
            answerScreenType = "answer-screen";
        }

        const choicesCheck = answerContent.content.find(content => {
            if (!content.type) return false;
            return content.type.includes("choices");
        });
        if (choicesCheck) {
            answerObject = choicesCheck;
            answerScreenType = "choices";
        }
    }

    let prompt;
    switch(answerScreenType) {
        case "answer-screen":
            let answerScreen = '';
            for (const answerPart of answerObject.content.filter(content => content.type.includes("answer-part"))) {
                const answerPartTextArray = [];
                for (const answerPartContent of answerPart.content) {
                    if (answerPartContent.element === "text") {
                        answerPartTextArray.push(answerPartContent.text);
                    } else if (answerPartContent.element === "slot") {
                        answerPartTextArray.push(`[${answerPartContent.ref}:${answerPartContent.accept}]`);
                    } else if (answerPartContent.element === "number-field") {
                        answerPartTextArray.push(`(${answerPartContent.ref})`);
                    }
                }
                
                const answerPartText = answerPartTextArray.join(" ");
                answerScreen += `Answer Part: ${answerPartText}\n`;
            }
            
            for (const cardsPart of answerObject.content.filter(content => content.type.includes("cards"))) {
                const cardsId = cardsPart.id;
                answerScreen += `${cardsId} Choices:\n`;

                for (const cardPart of cardsPart.content.filter(content => content.element === "card")) {
                    const cardId = cardPart.ref;
                    const cardPartText = cardPart.content.find(content => content.element === "text")?.text;

                    if (!cardPartText) continue;

                    answerScreen += `${cardId}: ${cardPartText}\n`;
                }

                answerScreen += "\n";
            }

            prompt = `You are now an expert programmer experienced in building simple scripts to calculate answers to complex problems. Design code that calculates an answer that follows this specific schema:\n\n{\n  type: "object",\n  properties: {\n    answers: {\n      type: "array",\n      items: {\n        type: "object",\n        properties: {\n          id: {\n            type: "string"\n          },\n        answer: {\n          type: "string"\n        }\n      },\n      required: [\n        "id",\n        "answer"\n      ]\n    }\n  }\n},\n  required: [\n    "answers"\n  ]\n}\n\nYou are now answering a question that may have choices and/or number inputs. Context about the answer is provided using the keyword 'Answer Part'. Choice groups are provided using the keyword 'Choices' proceeded by the 3 letter ID that will be used to refer to that group of choices. In the answer parts, where there are two 3 letter IDs surrounded by square brackets, the ID after the colon refers to a choice group. To select an option for this, append a new object to the output array where the ID is the 3 letter ID before the colon and the answer is the 3 letter ID of the choice you would like to choose within the choice group. Where there is a 3 letter ID surrounded by normal brackets, this denotes a number input field. To give an answer for this, append a new object to the output array with the ID being the 3 letter ID of the number field and the answer being the plain number without any symbols such as slashes etc. It is absolutely necessary that number inputs are the plain number with the only symbol allowed being a decimal point. Make sure to follow these rules and solve the following question:\n\nQ: ${question}\n\n${answerScreen}`;

            break;
        case "choices":
            let choices = '';
            for (const choiceInfo of answerObject.content) {
                choices += `${choiceInfo.ref}: ${choiceInfo.content[0].text}\n`;
            }

            prompt = `You are now an expert programmer experienced in building simple scripts to calculate answers to complex problems. Design code that calculates an answer that follows this specific schema:\n\n{\n  type: "object",\n  properties: {\n    answers: {\n      type: "array",\n      items: {\n        type: "object",\n        properties: {\n          id: {\n            type: "string"\n          },\n        answer: {\n          type: "string"\n        }\n      },\n      required: [\n        "id",\n        "answer"\n      ]\n    }\n  }\n},\n  required: [\n    "answers"\n  ]\n}\n\nYou are now answering a question with choices where you can select multiple. The options will are listed below. For each option that you want to select as a valid answer, append a new object to the output array with the ID being the 3 letter value and the answer being the exact value after the colon including but not limited to the dollar sign and latex syntax. Make sure to follow these rules and solve the following question:\n\nQ: ${question}\n\n${choices}`;

            break;
        case "number-field":
            const inputId = answerObject.ref;

            prompt = `You are now an expert programmer experienced in building simple scripts to calculate answers to complex problems. Design code that calculates an answer that follows this specific schema:\n\n{\n  type: "object",\n  properties: {\n    answers: {\n      type: "array",\n      items: {\n        type: "object",\n        properties: {\n          id: {\n            type: "string"\n          },\n        answer: {\n          type: "string"\n        }\n      },\n      required: [\n        "id",\n        "answer"\n      ]\n    }\n  }\n},\n  required: [\n    "answers"\n  ]\n}\n\nYou are now answering a question that has number inputs. To give an answer for these, append a new object to the output array with the ID being the 3 letter ID of the number field and the answer being the plain number without any symbols such as slashes etc. It is absolutely necessary that number inputs are the plain number with the only symbol allowed being a decimal point. Make sure to follow these rules and solve the following question:\n\nQ: ${question}\n\n${inputId}: Number field`;

            break;
    }

    if (!prompt) {
        console.log(JSON.stringify(layoutInfo));
        return [];
    }

    let image;
    if (imageUrl) {
        const imageRequest = await fetch(imageUrl);
        const imageBlob = await imageRequest.blob();
        const imageBuffer = await imageBlob.arrayBuffer();
        const imageBase64 = Buffer.from(imageBuffer).toString("base64");

        image = {
            inlineData: {
                data: imageBase64,
                mimeType: 'image/png',
            }
        }
    }

    // await new Promise(resolve => setTimeout(resolve, 1000 * 30));
    await new Promise(resolve => setTimeout(resolve, 1000 * 6));

    const result = await model.generateContent(
        imageUrl ? [image, prompt] : [prompt]
    );

    try {
        const jsonMatches = result.response.text().match(/```[json|tool_outputs](.|\n)*?```/g);
        const jsonOutput = JSON.parse(jsonMatches[jsonMatches.length - 1].replace(/```json/g, "").replace(/```/g, ""));

        return jsonOutput.answers;
    } catch (error) {
        // console.log(prompt);
        // console.log(result.response.text());
        return [];
    }
}

export { Activity };