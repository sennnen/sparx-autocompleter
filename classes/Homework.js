import { Sparx } from "./Sparx.js";

/** Class representing a Homework. */
class Homework {
    /**
     * Create a Homework.
     * 
     * @param {Sparx} sparxClient - The Sparx client
     * @param {string} id - The ID of the homework
     * @param {Date} created - The date the homework was created
     * @param {Date} due - The date the homework is due
     * @param {string} name - The name of the homework
     * @param {number} totalAmountOfSections - The total amount of sections in the homework
     * @param {number} totalAmountOfQuestions - The total amount of questions in the homework
     * @param {number} completedAmountOfQuestions - The completed amount of questions in the homework
     * @param {number} completedAmountOfSections - The completed amount of sections in the homework
     * @param {number} amountOfSectionsStarted - The amount of sections started in the homework
     */
    constructor(
        sparxClient,
        id,
        created,
        due,
        name,
        totalAmountOfSections,
        totalAmountOfQuestions,
        completedAmountOfQuestions,
        completedAmountOfSections,
        amountOfSectionsStarted,
    ) {
        this.client = sparxClient;
        this.id = id;
        this.created = created;
        this.due = due;
        this.name = name;
        this.totalAmountOfSections = totalAmountOfSections;
        this.totalAmountOfQuestions = totalAmountOfQuestions;
        this.completedAmountOfQuestions = completedAmountOfQuestions;
        this.completedAmountOfSections = completedAmountOfSections;
        this.amountOfSectionsStarted = amountOfSectionsStarted;
    }

    async getTasks() {
        return this.client.getHomeworkTasks(this.id);
    }
}

/** Class representing a HomeworkTask. */
class HomeworkTask {
    /**
     * Create a HomeworkTask.
     * 
     * @param {Sparx} sparxClient - The Sparx client
     * @param {string} packageId - The ID of the package
     * @param {number} index - The index of the task
     * @param {string} name - The name of the task
     * @param {number} totalAmountOfQuestions - The total amount of questions in the task
     * @param {number} completedAmountOfQuestions - The completed amount of questions in the task
     * @param {boolean} completed - Whether the task is completed
     */
    constructor(
        sparxClient,
        packageId,
        index,
        name,
        totalAmountOfQuestions,
        completedAmountOfQuestions,
        completed,
    ) {
        this.client = sparxClient;
        this.packageId = packageId;
        this.index = index;
        this.name = name;
        this.totalAmountOfQuestions = totalAmountOfQuestions;
        this.completedAmountOfQuestions = completedAmountOfQuestions;
        this.completed = completed;
    }

    async getActivities() {
        return this.client.getTaskActivities(this.packageId, this.index);
    }

    async getActivity(activityIndex) {
        return this.client.getActivity(this.packageId, this.index, activityIndex);
    }
}

export { Homework, HomeworkTask };