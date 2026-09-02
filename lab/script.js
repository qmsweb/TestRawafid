const quizData = [
  {
    question: "What is the result of '2' + 2 in JavaScript?",
    choices: ['4', '22', 'NaN', 'Error'],
    correctAnswer: 1,
  },
  {
    question: 'Which method is used to add elements to the end of an array?',
    choices: ['push()', 'pop()', 'unshift()', 'shift()'],
    correctAnswer: 0,
  },
  {
    question: 'What does `NaN` stand for in JavaScript?',
    choices: [
      'No Any Number',
      'Negative Any Number',
      'Null and None',
      'Not a Number',
    ],
    correctAnswer: 3,
  },
];

const questionContainer = document.getElementById('question-container');
const questionElement = document.getElementById('question');
const choicesElement = document.getElementById('choices');
const submitButton = document.getElementById('submit-btn');
const resultElement = document.getElementById('result');

let currentQuestion = 0;
let score = 0;
const wrongAnswers = [];

function loadQuestion() {
  const { question, choices } = quizData[currentQuestion];
  questionElement.textContent = question;
  choicesElement.innerHTML = '';

  choices.forEach((choice, index) => {
    const button = document.createElement('button');
    button.textContent = choice;
    button.addEventListener('click', () => selectChoice(index));
    choicesElement.appendChild(button);
  });
}

function selectChoice(index) {
  [...choicesElement.children].forEach((button) => {
    button.classList.remove('selected');
  });
  choicesElement.children[index].classList.add('selected');
}

function submitAnswer() {
  const selectedButton = choicesElement.querySelector('.selected');
  if (!selectedButton) return;

  const selectedIndex = [...choicesElement.children].indexOf(selectedButton);
  if (selectedIndex === quizData[currentQuestion].correctAnswer) {
    score++;
  } else {
    wrongAnswers.push({
      question: quizData[currentQuestion].question,
      userAnswer: quizData[currentQuestion].choices[selectedIndex],
      correctAnswer:
        quizData[currentQuestion].choices[
          quizData[currentQuestion].correctAnswer
        ],
    });
  }

  currentQuestion++;

  if (currentQuestion < quizData.length) {
    loadQuestion();
  } else {
    showResult();
  }
}

function showResult() {
  questionContainer.style.display = 'none';
  submitButton.style.display = 'none';

  let resultHTML = `
    <p class='score'>You scored 
      ${Math.round((score * 100) / quizData.length)}%
      (${score} out of ${quizData.length})
    </p>
  `;

  if (wrongAnswers.length > 0) {
    resultHTML += '<h3>Wrong Answers</h3>';
    resultHTML += '<ul>';
    wrongAnswers.forEach((answer) => {
      resultHTML += `
      <li>
      <p>Question: ${answer.question}</p>
      <p>Your Answer: <span class='wrong'>${answer.userAnswer}</span></p>
      <p>Correct Answer: <span class='correct'>${answer.correctAnswer}</span></p>
      </li>
      `;
    });
    resultHTML += '</ul>';
  }

  resultElement.innerHTML = resultHTML;
}

submitButton.addEventListener('click', submitAnswer);

loadQuestion();
