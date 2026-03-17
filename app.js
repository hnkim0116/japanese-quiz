/**
 * [전역 상태 관리]
 */
let DB = { sentences: [], words: {}, scenes: {} };
let currentCardIndex = 0;
let currentCategoryIds = [];

/**
 * [1. 핵심 유틸리티]
 */

function saveWrongNote(id) {
    if (!id) return;
    let wrongList = JSON.parse(localStorage.getItem('wrong_notes') || '[]');
    if (!wrongList.includes(id)) {
        wrongList.push(id);
        localStorage.setItem('wrong_notes', JSON.stringify(wrongList));
    }
}

function removeWrongNote(id) {
    let wrongList = JSON.parse(localStorage.getItem('wrong_notes') || '[]');
    localStorage.setItem('wrong_notes', JSON.stringify(wrongList.filter(i => i !== id)));
    renderWrongNotes(); 
}

function speak(text) {
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(text);
    msg.lang = 'ja-JP';
    msg.rate = 0.9;
    window.speechSynthesis.speak(msg);
}

function celebrate() {
    if (typeof confetti === 'function') {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors: ['#8845C3', '#FF8CC3', '#4CAF50'] });
    }
}

/**
 * [2. 데이터 로드 및 초기화]
 */

async function loadData() {
    const loadingContent = document.getElementById('loading-content');
    const errorContent = document.getElementById('error-content');

    try {
        const [sRes, wRes] = await Promise.all([
            fetch('./japanese_sentences.json'),
            fetch('./basic_words.json')
        ]);

        // 응답 상태 확인 (404 에러 등 방지)
        if (!sRes.ok || !wRes.ok) throw new Error('Network response was not ok');

        const sData = await sRes.json();
        const wData = await wRes.json();

        DB.sentences = Object.keys(sData.sentences).map(id => ({ id, ...sData.sentences[id] }));
        DB.scenes = sData.scenes;
        DB.words = {
            hiragana: wData.gojuon.hiragana,
            katakana: wData.gojuon.katakana,
            numbers: wData.numbers.number.flat(),
            days: wData.numbers.day.flat()
        };
        
        renderCategories();

        // [성공 시] 로딩 오버레이 완전히 숨김
        document.getElementById('loading-overlay').style.display = 'none';

    } catch (e) {
        console.error("Load Error:", e);
        // [실패 시] 스피너는 숨기고 에러 메시지와 재시도 버튼 표시
        if (loadingContent) loadingContent.style.display = 'none';
        if (errorContent) errorContent.style.display = 'block';
    }
}

async function initTossBridge() {
    if (typeof window.toss !== 'undefined') {
        try {
            await toss.setNavigationBarColor({
                color: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#101012' : '#F2F4F6',
                buttonColor: '#8845C3'
            });
            const user = await toss.getUserInfo();
            if (user && user.name) {
                const greeting = document.getElementById('user-greeting');
                if (greeting) greeting.innerText = `${user.name} 님의 일본어 퀴즈 ✨`;
            }
        } catch (e) { console.warn("Toss SDK Inactive"); }
    }
}

/**
 * [3. 내비게이션 관리]
 */

function changeView(viewId, navEl, pushHistory = true) {
    if (pushHistory) history.pushState({ view: viewId }, '', '');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('active');
    
    if (navEl) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        navEl.classList.add('active');
    }

    if (viewId === 'random') nextRandomQuiz();
    if (viewId === 'wrong') renderWrongNotes();
    if (viewId === 'my') updateJourney();
    if (viewId === 'home') renderCategories();
    if (viewId === 'words') changeWordTab('hiragana', document.querySelector('#word-tabs .tab'));
}

window.onpopstate = (e) => {
    // 1. 현재 히스토리 상태가 없거나 'home'인 상태에서 뒤로가기가 발생하면
    if (!e.state || e.state.view === 'home') {
        // 토스 웹뷰 종료 호출 (안드로이드 물리 뒤로가기 대응)
        if (window.toss && typeof toss.closeWebView === 'function') {
            toss.closeWebView();
        } else {
            // 토스 밖(일반 브라우저)에서 테스트용
            changeView('home', null, false);
        }
    } else {
        // 2. 그 외의 뷰라면 해당 뷰로 이동
        const view = e.state.view;
        changeView(view, null, false);
    }
};

function handleBack() { window.history.back(); }

/**
 * [4. 기초 문장 퀴즈 - 로직 수정됨]
 */

function renderCategories() {
    const list = document.getElementById('category-list');
    if (!list) return;
    list.innerHTML = Object.keys(DB.scenes).map(cat => {
        const total = DB.scenes[cat].length;
        const done = DB.scenes[cat].filter(id => localStorage.getItem(`mission_${id}`)).length;
        return `
            <div class="card" onclick="startCategoryQuiz('${cat}')">
                <div>
                    <div style="font-weight:800; font-size:18px;">${cat}</div>
                    <div style="font-size:12px; color:var(--primary); margin-top:4px;">${done} / ${total} 완료</div>
                </div>
                <div style="color:#CCC; font-weight:bold;">＞</div>
            </div>`;
    }).join('');
}

// targetId 인자 추가: 오답노트에서 특정 문장으로 바로 이동하기 위함
function startCategoryQuiz(cat, targetId = null) {
    changeView('list');
    document.getElementById('list-title').innerText = cat;
    currentCategoryIds = DB.scenes[cat];
    
    if (targetId) {
        // 특정 ID가 전달된 경우 해당 문장의 위치를 찾음
        const targetIdx = currentCategoryIds.indexOf(targetId);
        currentCardIndex = (targetIdx !== -1) ? targetIdx : 0;
    } else {
        // 일반적인 경우: 안 푼 첫 번째 문제 인덱스 찾기
        const unsolvedIdx = currentCategoryIds.findIndex(id => !localStorage.getItem(`mission_${id}`));
        currentCardIndex = (unsolvedIdx === -1) ? currentCategoryIds.length : unsolvedIdx;
    }
    
    showNextCard();
}

function showNextCard() {
    const container = document.getElementById('card-container');
    if (currentCardIndex >= currentCategoryIds.length) {
        container.innerHTML = `<div class="quiz-card"><h2>🎉 모두 완료했습니다!</h2><button class="choice-btn btn-primary" onclick="handleBack()">목록으로 돌아가기</button></div>`;
        return;
    }
    const id = currentCategoryIds[currentCardIndex];
    const item = DB.sentences.find(s => s.id === id);
    container.innerHTML = `
        <div class="quiz-card">
            <div class="jp-text-xl" onclick="speak('${item.phrase}')">${item.phrase}</div>
            <div id="meaning-box" class="meaning-blur">${item.meaning}</div>
            <div id="quiz-options">
                <button class="choice-btn btn-primary" onclick="revealQuiz('${id}')">퀴즈 풀기 시작</button>
            </div>
            <div id="quiz-feedback" style="margin-top:15px; font-weight:bold; min-height:22px;"></div>
        </div>`;
    speak(item.phrase);
}

function revealQuiz(id) {
    const item = DB.sentences.find(s => s.id === id);
    document.getElementById('meaning-box').classList.add('blurred');
    const others = DB.sentences.filter(s => s.id !== id).sort(() => 0.5 - Math.random()).slice(0, 2).map(s => s.meaning);
    const choices = [item.meaning, ...others].sort(() => 0.5 - Math.random());
    document.getElementById('quiz-options').innerHTML = choices.map(c => `
        <button class="choice-btn" onclick="checkCardAnswer('${id}', '${c}', '${item.meaning}')">${c}</button>
    `).join('');
}

function checkCardAnswer(id, selected, correct) {
    const fb = document.getElementById('quiz-feedback');
    if (selected === correct) {
        fb.innerHTML = `<span style="color:var(--success)">정답! 🎉</span>`;
        celebrate();
        if (window.toss && toss.vibrate) toss.vibrate('success');
        localStorage.setItem(`mission_${id}`, 'true');
        setTimeout(() => { currentCardIndex++; showNextCard(); }, 800);
    } else {
        fb.innerHTML = `<span style="color:var(--error)">오답 😢</span>`;
        if (window.toss && toss.vibrate) toss.vibrate('error');
        saveWrongNote(id); 
    }
}

/**
 * [5. 기초 단어 & 단어 퀴즈]
 */

function changeWordTab(type, el) {
    if (el) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        el.classList.add('active');
    }
    const container = document.getElementById('word-content-container');
    const tip = document.getElementById('word-tip');
    
    if (type === 'quiz') { 
        if (tip) tip.style.display = 'none';
        renderWordQuiz(); 
        return; 
    }
    
    if (tip) tip.style.display = 'block';
    if (type === 'hiragana' || type === 'katakana') {
        let html = `<table class="kana-table">`;
        DB.words[type].forEach(row => {
            html += `<tr>${row.map(c => c.kana ? `<td onclick="speak('${c.kana}')"><b style="color:var(--primary); font-size:24px; display:block;">${c.kana}</b><small style="color:#ABB5BD; font-weight:700;">${c.kr}</small></td>` : '<td></td>').join('')}</tr>`;
        });
        container.innerHTML = html + `</table>`;
    } else {
        container.innerHTML = `<div class="word-grid">` + DB.words[type].filter(w => w.kana).map(w => `
            <div class="word-card" onclick="speak('${w.kana}')">
                <b style="color:var(--primary); font-size:28px;">${w.kana}</b>
                <span style="font-weight:800; font-size:16px; margin-top:4px;">${w.meaning}</span>
                <small style="color:#adb5bd;">${w.kr || w.roma}</small>
            </div>`).join('') + `</div>`;
    }
}

function renderWordQuiz() {
    const container = document.getElementById('word-content-container');
    const allWords = [...DB.words.numbers, ...DB.words.days].filter(w => w.kana && w.meaning);
    const item = allWords[Math.floor(Math.random() * allWords.length)];
    const others = allWords.filter(w => w.kana !== item.kana).sort(() => 0.5 - Math.random()).slice(0, 2).map(o => o.meaning);
    const choices = [item.meaning, ...others].sort(() => 0.5 - Math.random());
    
    container.innerHTML = `<div class="quiz-card" style="box-shadow:none;">
        <div class="jp-text-xl">${item.kana}</div>
        <div>${choices.map(c => `<button class="choice-btn" onclick="checkWordQuizAnswer('${c}', '${item.meaning}')">${c}</button>`).join('')}</div>
        <div id="word-quiz-feedback" style="margin-top:15px; font-weight:bold; min-height:22px;"></div>
    </div>`;
    speak(item.kana);
}

function checkWordQuizAnswer(selected, correct) {
    const fb = document.getElementById('word-quiz-feedback');
    if (selected === correct) {
        fb.innerHTML = `<span style="color:var(--success)">정답!</span>`; celebrate();
        setTimeout(renderWordQuiz, 800);
    } else fb.innerHTML = `<span style="color:var(--error)">오답</span>`;
}

/**
 * [6. 무한 랜덤 퀴즈]
 */

function nextRandomQuiz() {
    const item = DB.sentences[Math.floor(Math.random() * DB.sentences.length)];
    const modes = ['jpKo', 'koJp', 'audioKo', 'audioJp'];
    const mode = modes[Math.floor(Math.random() * modes.length)];
    const others = DB.sentences.filter(s => s.id !== item.id).sort(() => 0.5 - Math.random()).slice(0, 2);
    let q = "", sub = "", ansText = "", choices = [];

    switch(mode) {
        case 'jpKo': q = `<span class="jp-text-xl">${item.phrase}</span>`; sub = "뜻을 고르세요"; ansText = item.meaning; choices = [item.meaning, others[0].meaning, others[1].meaning]; break;
        case 'koJp': q = `<span style="font-size:24px; font-weight:800;">${item.meaning}</span>`; sub = "일본어 문장은?"; ansText = item.phrase; choices = [item.phrase, others[0].phrase, others[1].phrase]; break;
        case 'audioKo': q = "🔈 재생 중"; sub = "들리는 뜻은?"; ansText = item.meaning; choices = [item.meaning, others[0].meaning, others[1].meaning]; speak(item.phrase); break;
        case 'audioJp': q = "🔈 재생 중"; sub = "들리는 문장은?"; ansText = item.phrase; choices = [item.phrase, others[0].phrase, others[1].phrase]; speak(item.phrase); break;
    }

    const area = document.getElementById('random-quiz-area');
    if (area) {
        area.innerHTML = `
            <div style="min-height:100px; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                ${q}<div style="margin-top:10px; color:#8B95A1; font-weight:700;">${sub}</div>
            </div>
            <div>${choices.sort(() => 0.5 - Math.random()).map(c => `<button class="choice-btn" onclick="checkRandomAnswer('${item.id}', '${c}', '${ansText}')">${c}</button>`).join('')}</div>
            <div id="random-feedback" style="margin-top:15px; font-weight:bold; min-height:22px;"></div>`;
    }
}

function checkRandomAnswer(id, selected, correct) {
    const fb = document.getElementById('random-feedback');
    if (selected === correct) {
        fb.innerHTML = `<span style="color:var(--success)">정답! 🎉</span>`; celebrate();
        setTimeout(nextRandomQuiz, 800);
    } else {
        fb.innerHTML = `<span style="color:var(--error)">오답 😢</span>`;
        saveWrongNote(id); 
    }
}

/**
 * [7. 오답 노트 & 여정]
 */

function renderWrongNotes() {
    const container = document.getElementById('wrong-note-list');
    const wrongIds = JSON.parse(localStorage.getItem('wrong_notes') || '[]');
    if (wrongIds.length === 0) {
        container.innerHTML = `<div class="card" style="justify-content:center; color:#CCC;">오답이 없습니다.</div>`;
        return;
    }
    container.innerHTML = wrongIds.map(id => {
        const item = DB.sentences.find(s => s.id === id);
        if (!item) return '';
        // '학습하러 가기' 버튼의 onclick 이벤트 수정: startCategoryQuiz(카테고리, 문장ID)
        return `
            <div class="card" style="flex-direction:column; align-items:flex-start;" onclick="speak('${item.phrase}')">
                <b style="color:var(--primary); font-size:24px; display:block;">${item.phrase}</b>
                <span style="font-weight:800; font-size:16px;">${item.meaning}</span>
                <div style="display:flex; gap:10px; width:100%; margin-top:10px;">
                    <button class="choice-btn" style="padding:8px; font-size:12px; margin:0; flex:1;" onclick="event.stopPropagation(); removeWrongNote('${id}')">삭제</button>
                    <button class="choice-btn btn-primary" style="padding:8px; font-size:12px; margin:0; flex:1;" onclick="event.stopPropagation(); startCategoryQuiz('${item.scene}', '${id}')">학습하러 가기</button>
                </div>
            </div>`;
    }).join('');
}

function updateJourney() {
    const doneTotal = DB.sentences.filter(s => localStorage.getItem(`mission_${s.id}`)).length;
    const percent = Math.round((doneTotal / DB.sentences.length) * 100);
    document.getElementById('total-percent').innerText = `${percent}% 정복`;
    document.getElementById('total-bar').style.width = `${percent}%`;
    document.getElementById('total-count').innerText = `전체 ${doneTotal} / ${DB.sentences.length} 문장 완료`;
    document.getElementById('journey-category-list').innerHTML = Object.keys(DB.scenes).map(cat => {
        const ids = DB.scenes[cat];
        const done = ids.filter(id => localStorage.getItem(`mission_${id}`)).length;
        const p = Math.round((done / ids.length) * 100);
        return `<div class="card" style="flex-direction:column; align-items:flex-start; cursor:default;">
            <div style="display:flex; justify-content:space-between; width:100%; font-weight:800; font-size:15px; margin-bottom:4px;">
                <span>${cat}</span><span>${p}%</span>
            </div>
            <div class="chart-bar-bg" style="width:100%;"><div class="chart-bar-fill" style="width:${p}%"></div></div>
        </div>`;
    }).join('');
}

// [시작]
window.onload = () => {
    history.replaceState({ view: 'home' }, '', ''); 
    loadData();
    initTossBridge();
};