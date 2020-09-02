"use strict";

//TODO: "Critical" items?
//TODO: Manual input? Could be tricky - spearate boxes for vocab & kanji?

localforage.config({
  // driver      : localforage.INDEXEDDB,
  name        : "BishBashOnce",
  version     : 1.0,
  storeName   : 'bishbashonce'
});

const TESTMODE = true;

const apiRoot = "https://api.wanikani.com/v2/";
const initialHandSize = 3;
const maxHandSize = 8;
const increaseHandThreshold = 2;
const startingScore = 2;
const discardScore = 5;
const goodResults = ["OK","GOOD","RIGHT","NICE","WOOO","GREAT","OMG","ooOOoOOoO","!!!!!",
  "(â—•â€¿â—•)", "(â‰§â—¡â‰¦) â™¡", "( : à±¦ â€¸ à±¦ : )", "(^_âˆ’)â˜†", "Î¶Â°)))å½¡", "â”Œ(ï¼¾ï¼¾)â”˜"];
const badResults = ["DOH","ARGH","NOPE","OOPS!",":-(", "NOOOO", "(á—’á—£á—•)Õž"];
const colours = {radical: "#41cdf4", kanji: "#f442e5", vocabulary: "#9541f4"};
let isLoading = false;
let apiKey = "";

function levenshtein(a, b) {
  let t = [], u, i, j, m = a.length, n = b.length;
  if (!m) { return n; }
  if (!n) { return m; }
  for (j = 0; j <= n; j++) { t[j] = j; }
  for (i = 1; i <= m; i++) {
    for (u = [i], j = 1; j <= n; j++) {
      u[j] = a[i - 1] === b[j - 1] ? t[j - 1] : Math.min(t[j - 1], t[j], u[j - 1]) + 1;
    } t = u;
  } return u[n];
}

function queryStr() {
  try {
    return _(window.location.search.substr(1)).split("&")
      .map(x => x.split("=")).fromPairs().value();
  } catch (err) {
    return {};
  }
}

function clearLocal() {
  return localforage.clear().then(() => {
    return;
  });
}

function getLocal(dataId, cacheHours, def) {
  return localforage.getItem(dataId).then(result => {
    if (!result) {
      return def || null;
    }
    if (!cacheHours || result.timestamp + cacheHours * 60 * 60 * 1000 > Date.now()) {
      return result.data;
    } else {
      return localforage.removeItem(dataId).then(() => def || null);
    }
  });
}

function storeLocal(dataId, data) {
  return localforage.setItem(dataId, {
    timestamp: Date.now(),
    data: data
  }).then(d => d.data).catch( err => {
    if (err && err.name === "QuotaExceededError") {
      console.warn( "Exceeded quota when storing " + dataId );
      return data;
    }
    throw err;
  });
}

function usableFormData(id) {
  const fd = new FormData(document.querySelector("#"+id));
  return _.fromPairs(Array.from(fd.entries()));
}

function fetchWk(endpoint) {
  if (endpoint.substr(0,4) !== "http") {
    endpoint = apiRoot + endpoint;
  }
  return fetch(
    endpoint,
    {
      headers: {
        "Wanikani-Revision": "20170710",
        "Authorization": "Bearer " + apiKey
      }
    }
  ).then(res => res.json()).catch( e => {
    throw new Error("Error fetching " + endpoint + "\n'" + e.message + "'");
  });
}

function pullWholeCollection(endpoint) {
  return new Promise((resolve, reject) => {
    let numItemsPulled = 0;
    let results = [];
    const handleResult = result => {
      if (result.error) {
        throw new Error("Failed to fetch " + endpoint + ", message was '" + result.code +
          " " + result.error);
      }
      results.push(result);
      numItemsPulled += result.data.length;
      if (numItemsPulled < result.total_count) {
        return fetchWk(result.pages.next_url).then(handleResult);
      } else {
         return resolve(_(results).map("data").flatten().value());
      }
    };
    fetchWk(endpoint).then(handleResult).catch(reject);
  } );
}

function cachedFetchAll(collectionName, cacheHours) {
  return getLocal(collectionName, cacheHours).then(local => {
    if (local) {
      return Promise.resolve(local);
    }
    return pullWholeCollection(collectionName).then( data => {
      return storeLocal(collectionName, data);
    });
  });
}

function fetchRecentlyFailed() {
  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString();
  return pullWholeCollection("reviews?updated_after=" + cutoff).then(list => {
    return _(list)
      .filter(x => x.data.incorrect_meaning_answers || x.data.incorrect_reading_answers)
      .uniqBy("data.subject_id")
      .value();
  });
}

function fetchTenOldestApprentices() {
  return pullWholeCollection("assignments?srs_stages=1,2,3,4").then(list => {
    const output = _(list).sortBy(["data.created_at"]).take(10).value();
    return output;
  });
}

function fetchAllThatStuff() {
  return Promise.all([pullWholeCollection("assignments?srs_stages=1"),
    fetchRecentlyFailed(), fetchTenOldestApprentices()]).then(([a1, rfailed, oldest]) => {
      return _.unionBy(a1, rfailed, oldest, "data.subject_id");
    });
}

function fetchAncientGurus() {
  // 4 random gurus older than 10 weeks and not seen in in the past 2 days,
  // picked from the oldest 20
  const ageCutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7 * 10);
  const recentCorrectCutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 2);
  return pullWholeCollection("assignments?srs_stages=5,6").then(list => {
    const output = _(list)
      .sortBy(["data.created_at"])
      .filter(x => new Date(x.data_updated_at) < recentCorrectCutoff)
      .take(20)
      .filter(x => ageCutoff > new Date(x.data.created_at))
      .shuffle()
      .take(4).value();
    return output;
  });
}

function fetchAllThatStuffPlusGurus() {
  return Promise.all([fetchAllThatStuff(), fetchAncientGurus()])
    .then(([ats, agurus]) => _.unionBy(ats, agurus, "data.subject_id"));
}

function fetchStudyMaterials() {
  return getLocal("customSubjects", 1/4).then(local => {
    if (local) {
      return local;
    }
    return pullWholeCollection("study_materials").then(studyMats => {
      const subjects = _.reduce(studyMats, (result, value) => {
        const rn = value.data.reading_note;
        const mn = value.data.meaning_note;
        result[value.data.subject_id] = {
          id: value.data.subject_id,
          accepted_meanings: _.map(value.data.meaning_synonyms || [], x => x.toLowerCase()),
          meaning_mnemonic: (mn ? mn + "<hr>" : "").replace("\n", "<br>"),
          reading_mnemonic: (rn ? rn + "<hr>" : "").replace("\n", "<br>"),
        };
        return result;
      }, []);
      return storeLocal("customSubjects", subjects);
    });
  });
}

function fetchSubjects() {
  return getLocal("subjects", 24 * 7).then(local => {
    if (local) {
      return local;
    }
    return pullWholeCollection("subjects").then(rawSubjects => {
      // ensure it's indexed by ID, preprocess
      let subjects = _.reduce(rawSubjects, (result, value) => {
        if (!value.data.characters) {
          const svgUrl = _.find(value.data.character_images,
            x => x.content_type === "image/svg+xml" && x.metadata.inline_styles).url;
          if (svgUrl) {
            value.data.characters = '<div class="wkSvg"><img src="' + svgUrl + '""></div>';
          }
        }
        result[value.id] = {
          id: value.id,
          object: value.object,
          label: value.data.characters || value.data.slug,
          accepted_readings: _(value.data.readings).filter({accepted_answer: true}).map("reading").map(x => x.toLowerCase()).value(),
          bad_readings: _(value.data.readings).filter({accepted_answer: false}).map("reading").value(),
          accepted_meanings: _(value.data.meanings).filter({accepted_answer: true}).map("meaning").map(x => x.toLowerCase()).value(),
          primary_readings: _(value.data.readings).filter({primary: true}).map("reading").join(", "),
          primary_meanings: _(value.data.meanings).filter({primary: true}).map("meaning").join(", "),
          level: value.data.level,
          meaning_mnemonic: _.get(value, "data.meaning_mnemonic", "").replace("\n", "<br>"),
          reading_mnemonic: _.get(value, "data.reading_mnemonic", "").replace("\n", "<br>"),
          audio: _(_.get(value.data, "pronunciation_audios", []))
            .filter({content_type: "audio/mpeg"}).map("url").value()
        };
        return result;
      }, []);
      return storeLocal("subjects", subjects);
    });
  });
}


function play(assignments, subjects) {
  const answerField = document.querySelector("#answer");
  const questionDiv = document.querySelector("#question");
  const whatToPut = document.querySelector("#whattoput");
  const solution = document.querySelector("#solution");
  const queue = document.querySelector("#queue");
  const result = document.querySelector("#result");
  const tpl = _.template(
    '<span class="label"><%= label %></span><br>' +
    '<span class="kind" style="border-color:<%= colours[object] %>"><%= object %></span>'
  );
  const solTpl = _.template('<h2><%= title %></h2><%= sub.length > 1 ? "<h4>" + sub.join(", ") + "</h4>" : "" %><p><%= body %></p>');

  const PH_MEANING = 1;
  const PH_READING = 2;

  const now = new Date();
  const deck = _(assignments).map(a => ({
    score: startingScore,
    perfect: true,
    type: a.data.subject_type,
    subject: subjects[a.data.subject_id],
    availNow: new Date(a.data.available_at) <= now
  })).shuffle().orderBy(["availNow"],["desc"]).value();
  const hand = deck.splice(0, Math.min(initialHandSize, deck.length));
  const pile = [];
  subjects = null; // free some ram

  let phase = PH_MEANING;
  let hadError = false;
  let curAudio = null;

  function check() {
    if (phase === PH_READING && !wanakana.isKana(answerField.value)) {
      // catch unfinished n's etc
      answerField.value = wanakana.toKana(answerField.value);
    }
    const card = hand[0], subj = card.subject;
    const answer = _.trim(answerField.value).toLowerCase();
    if (answer === "") { return; }
    if (TESTMODE && answer==="1" || answer==="2") {
      return answer === "1" ? success() : fail();
    }
    if (phase === PH_MEANING) {
      const found = _.find(subj.accepted_meanings,
        m => levenshtein(m, answer) <= Math.floor(1 + m.length/5));
      return found ? success() : fail();
    } else {
      if (subj.accepted_readings.includes(answer)) {
        return success();
      } else if (subj.bad_readings.includes(answer)) {
        return notQuite();
      } else {
        const rom = wanakana.toRomaji(answer);
        const foundClose = _.find(subj.accepted_readings,
          m => levenshtein(wanakana.toRomaji(m), rom) <= (m.length < 2 ? 0 : 1));
        if (foundClose) {
          return notQuite();
        }
      }
      return fail();
    }
  };
  function maybeAddFronDeck() {
    const lowestHandScore = _(hand).map("score").min();
    if (lowestHandScore >= increaseHandThreshold && hand.length < maxHandSize && deck.length) {
      hand.unshift(deck.pop());
    }
  }
  function animateResult(isCorrect, score) {
    result.innerHTML = (isCorrect ? goodResults : badResults)[score];
    result.classList.remove("animate");
    void result.offsetWidth; // interesting hack
    result.classList.add("animate");
    result.classList.remove("right");
    result.classList.remove("wrong");
    result.classList.add(isCorrect ? "right" : "wrong");
  }
  function success() {
    const card = hand[0], subj = card.subject;
    animateResult(true, card.score);
    if (subj.object === "radical" || phase === PH_READING) {
      if (curAudio) { curAudio.play(); }
      if (hadError) {
        hand.splice(1, 0, hand.shift());
      } else {
        card.score += card.perfect ? 2 : 1;
        const enoughStillInPlay = deck.length > 0 || hand.length > initialHandSize;
        const allDone = _(hand).map("score").min() >= discardScore;
        if (card.score >= discardScore) {
          if (!enoughStillInPlay) {
            if (_(hand).map("score").min() >= discardScore) {
              // discard all
              while (hand.length) {
                pile.push(hand.shift());
              }
            } else {
              // rotate to back
              hand.push(hand.shift());
            }
          } else {
            // discard
            pile.push(hand.shift());
          }
        } else {
          // move back in hand
          hand.splice(Math.min(hand.length-1, card.score*3), 0, hand.shift());
        }
        maybeAddFronDeck();
      }
      hadError = false;
      phase = PH_MEANING;
    } else {
      phase = PH_READING;
    }
    display();
  }
  function notQuite() {
    const card = hand[0];
    card.perfect = false;
    solution.innerHTML = "<h2>Not quite...</h2>";
    solution.style.display = "block";
    answerField.value = "";
  }
  function fail() {
    const card = hand[0], subj = card.subject;
    animateResult(false, card.score);
    if (phase === PH_MEANING) {
      solution.innerHTML = solTpl({title: subj.primary_meanings, sub: subj.accepted_meanings, body: subj.meaning_mnemonic});
    } else {
      if (curAudio) { curAudio.play(); };
      solution.innerHTML = solTpl({title: subj.primary_readings, sub: subj.accepted_readings, body: subj.reading_mnemonic});
    }
    if (!hadError) {
      card.score = Math.max(0, card.score - 2);
      card.perfect = false;
    }
    solution.style.display = "block";
    answerField.value = "";
    answerField.placeholder = "Nope :(    Try again...";
    hadError = true;
  }
  function display() {
    const card = hand[0];
    if (!card) {
      answerField.style.display = "none";
      whatToPut.style.display = "none";
      questionDiv.innerHTML = tpl({label:"BOSH!",object:""});
      document.querySelector("#info").style.display = "block";
      redrawQueue();
      return;
    }
    questionDiv.innerHTML = tpl(card.subject);
    switchInputMode(phase === PH_READING);
    whatToPut.innerHTML = phase === PH_READING ? "èª­ã¿æ–¹" : "MEANING";
    answerField.value = "";
    answerField.placeholder = "";
    answerField.style.display = "inline-block";
    whatToPut.style.display = "block";
    solution.style.display = "none";
    curAudio = _.get(card, "subject.audio.length", 0) ? new Audio(_.sample(card.subject.audio)) : null;
    redrawQueue();
    answerField.focus();
  }
  function redrawQueue() {
    const style = score => {
      const offset = Math.round(score / discardScore * 55);
      return 'style="background-color: rgb(' + (255-offset) + ',' + (200+offset) + ',200);"';
    };
    queue.innerHTML = '<strong style="color:#2c2;">' + pile.length + "</strong> + " +
      _.map(hand, c => "<span " + style(c.score) + ">" + c.subject.label + "</span>").join("") +
      ' + <strong style="color:#f22;">' + deck.length + "</strong>";
  }

  function switchInputMode(isKana) {
    try {
      wanakana.unbind(answerField);
    } catch (err) {
      // fails if not bound already and I'm lazy
    }
    if (isKana) {
      wanakana.bind(answerField, {
        IMEMode: true
      });
    }
  }

  answerField.addEventListener("keydown", ev => {
    if (ev.keyCode !== 13) { return; }
    check();
  });

  display();
}

document.querySelector("#apiKeyForm").addEventListener("submit", e => {
  e.preventDefault();
  if (isLoading) {
    return false;
  }
  const newApiKey = usableFormData("apiKeyForm").apiKey;
  if (newApiKey) {
    clearLocal()
      .then(() => storeLocal("apiKey", newApiKey))
      .then(() => window.location.reload());
  }
});

Promise.all([getLocal("apiKey", null, ""),
  getLocal("content", null, "apprentice1")]).then(([_apiKey, content]) => {

  apiKey = _apiKey;
  if (!apiKey) {
    document.querySelector("#apiKeyForm").style.display = "block";
    return;
  }
  document.querySelector("#contentSelector").style.display = "block";
  document.querySelector("#apiKey").setAttribute("value", apiKey);
  document.querySelector("input[value=" + content + "]").checked = true
  document.querySelector("#loading").style.display = "block";
  isLoading = true;

  const selectedContent = () => {
    switch (content) {
      case "apprentice1":
        const lvl = queryStr().srsLevelOverride || "1";
        return pullWholeCollection("assignments?srs_stages=" + lvl);
      case "recentlyFailed":
        return fetchRecentlyFailed();
      case "oldestApprentices":
        return fetchTenOldestApprentices();
      case "allThatStuff":
        return fetchAllThatStuff();
      case "plusGurus":
        return fetchAllThatStuffPlusGurus();
    }
  }

  Promise.all([selectedContent(), fetchSubjects(), fetchStudyMaterials()]).then(
    ([assignments, subjects, sm]) => {
      subjects.forEach(s => {
        const extra = sm[s.id];
        if (extra) {
          s.accepted_meanings = s.accepted_meanings.concat(extra.accepted_meanings);
          s.meaning_mnemonic = extra.meaning_mnemonic + s.meaning_mnemonic;
          s.reading_mnemonic = extra.reading_mnemonic + s.reading_mnemonic;
        }
      });

      document.querySelector("#loading").style.display = "none";
      isLoading = false;

      if (!assignments || assignments.length < 1) {
        window.alert("Nothing found to cram!");
        document.querySelector("#info").style.display = "block";
        return;
      }

      document.querySelector("#main").style.display = "block";
      play(assignments, subjects);
    }
  ).catch(err => {
    alert("Something went wrong...\n\nError was: " + err.message);
    return clearLocal().then(() => {
      return localforage.dropInstance();
    }).then(() => {
      window.location.reload()
    });
  });
});

document.querySelector("#contentSelectorForm").addEventListener("change", ev => {
  const content = usableFormData("contentSelectorForm").content;
  storeLocal("content", content).then(v => window.location.reload());
});

document.querySelector("#showApiForm").addEventListener("click", ev => {
  document.querySelector("#apiKeyForm").style.display = "block";
  document.querySelector("#showApiForm").style.display = "none";
});


/**

{
  "object": "collection",
  "url": "https://api.wanikani.com/v2/assignments?srs_stages=1",
  "pages": {
    "per_page": 500,
    "next_url": null,
    "previous_url": null
  },
  "total_count": 4,
  "data_updated_at": "2019-06-14T14:02:40.543476Z",
  "data": [
    {
      "id": 138465838,
      "object": "assignment",
      "url": "https://api.wanikani.com/v2/assignments/138465838",
      "data_updated_at": "2019-06-14T13:12:09.075711Z",
      "data": {
        "created_at": "2019-06-09T10:19:56.580172Z",
        "subject_id": 3189,
        "subject_type": "vocabulary",
        "srs_stage": 1,
        "srs_stage_name": "Apprentice I",
        "unlocked_at": "2019-06-09T10:19:56.571213Z",
        "started_at": "2019-06-11T08:07:23.885930Z",
        "passed_at": null,
        "burned_at": null,
        "available_at": "2019-06-14T17:00:00.000000Z",
        "resurrected_at": null,
        "passed": false,
        "resurrected": false,
        "hidden": false
      }
    }
  ]
}


{
  "id": 840,
  "object": "kanji",
  "url": "https://api.wanikani.com/v2/subjects/840",
  "data_updated_at": "2019-05-02T22:40:39.893209Z",
  "data": {
    "created_at": "2012-05-01T19:54:39.000000Z",
    "level": 12,
    "slug": "æ¤",
    "hidden_at": null,
    "document_url": "https://www.wanikani.com/kanji/%E6%A4%8D",
    "characters": "æ¤",
    "meanings": [
      {
        "meaning": "Plant",
        "primary": true,
        "accepted_answer": true
      }
    ],
    "auxiliary_meanings": [],
    "readings": [
      {
        "type": "onyomi",
        "primary": true,
        "reading": "ã—ã‚‡ã",
        "accepted_answer": true
      },
      {
        "type": "kunyomi",
        "primary": false,
        "reading": "ã†",
        "accepted_answer": false
      }
    ],
    "component_subject_ids": [
      23,
      8821
    ],
    "amalgamation_subject_ids": [
      3381,
      6498,
      7748
    ],
    "visually_similar_subject_ids": [
      630,
      1164,
      1766,
      630,
      1164,
      1766,
      1176
    ],
    "meaning_mnemonic": "If you want to <radical>fix</radical> a <radical>tree</radical> you have to <kanji>plant</kanji> it. It's pretty obvious that digging up the tree broke it. So fix it by planting it again. That is how plants work.",
    "meaning_hint": "Is your tree broken? Fix it up by planting it somewhere else. Somewhere with the right amount of light and no biting bugs.",
    "reading_mnemonic": "If you don't <kanji>plant</kanji> a tree it goes into <reading>shock</reading> (<ja>ã—ã‚‡ã</ja>). Which, honestly, shouldn't be very shocking to you, since it's a tree.",
    "reading_hint": "Have you ever seen a tree in shock? Imagine it now. It's shaking and dying and sad. Make sure you properly plant all your trees from now on.",
    "lesson_position": 41
  }
}

*/



