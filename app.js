/**
 * [전역 상태 관리]
 */
let DB = { sentences: [], words: {}, scenes: {} };
let currentCardIndex = 0;
let currentCategoryIds = [];
let quizCount = 0; // 광고 카운터

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
 * [2. 광고 로직]
 */
async function loadBannerAd() {
    if (window.toss && typeof toss.showAd === 'function') {
        try {
            await toss.showAd({
                adUnitId: '', // 실제 ID로 교체
                type: 'BANNER',
                containerId: 'toss-ad-banner'
            });
        } catch (e) { console.error("배너 로드 실패", e); }
    }
}

async function showInterstitialAd() {
    quizCount++;
    if (quizCount % 5 === 0) { // 5문제마다
        if (window.toss && typeof toss.showAd === 'function') {
            try {
                await toss.showAd({
                    adUnitId: '', // 실제 ID로 교체
                    type: 'INTERSTITIAL'
                });
            } catch (e) { console.error("전면 광고 실패", e); }
        }
    }
}

/**
 * [3. 데이터 로드 및 내비게이션]
 */
async function loadData() {
    const loadingContent = document.getElementById('loading-content');
    const errorContent = document.getElementById('error-content');
    try {
        const [sRes, wRes] = await Promise.all([
            fetch('./japanese_sentences.json'),
            fetch('./basic_words.json')
        ]);
        if (!sRes.ok || !wRes.ok) throw new Error('Network error');
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
        document.getElementById('loading-overlay').style.display = 'none';
    } catch (e) {
        if (loadingContent) loadingContent.style.display = 'none';
        if (errorContent) errorContent.style.display = 'block';
    }
}

function changeView(viewId, el, pushState = true) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('active'));
    if (el) el.classList.add('active');

    if (viewId === 'wrong') updateJourney();
    if (pushState) history.pushState({ view: viewId }, '', '');
}

window.onpopstate = (e) => {
    if (!e.state || e.state.view === 'home') {
        if (window.toss && typeof toss.closeWebView === 'function') toss.closeWebView();
        else changeView('home', document.querySelector('.nav-item'), false);
    } else {
        changeView(e.state.view, null, false);
    }
};

/**
 * [4. 퀴즈 엔진]
 */
function startCategoryQuiz(catName, specificId = null) {
    currentCategoryIds = DB.scenes[catName] || [];
    currentCardIndex = specificId ? currentCategoryIds.indexOf(specificId) : 0;
    if (currentCardIndex === -1) currentCardIndex = 0;
    
    document.getElementById('list-title').innerText = catName;
    changeView('list');
    renderQuiz();
}

function startRandomQuiz() {
    currentCategoryIds = DB.sentences.map(s => s.id).sort(() => Math.random() - 0.5);
    currentCardIndex = 0;
    document.getElementById('list-title').innerText = "무한 랜덤 ⚡️";
    changeView('list');
    renderQuiz();
}

function renderQuiz() {
    const container = document.getElementById('card-container');
    if (currentCardIndex >= currentCategoryIds.length) {
        celebrate();
        container.innerHTML = `
            <div class="quiz-card">
                <h2 style="color:var(--primary)">모두 완료! 🎉</h2>
                <p>이 카테고리의 모든 문장을 마스터했습니다.</p>
                <button class="choice-btn" onclick="changeView('home')" style="margin-top:20px; background:var(--primary); color:white; border:none;">다른 카테고리 보기</button>
            </div>`;
        return;
    }

    const item = DB.sentences.find(s => s.id === currentCategoryIds[currentCardIndex]);
    const others = DB.sentences.filter(s => s.id !== item.id).sort(() => Math.random() - 0.5).slice(0, 2);
    const choices = [item, ...others].sort(() => Math.random() - 0.5);

    container.innerHTML = `
        <div class="quiz-card" onclick="speak('${item.phrase}')">
            <div class="phrase">${item.phrase}</div>
            <div class="meaning">${item.korean}</div>
            <div style="font-size:12px; color:var(--text-sub)">🔈 터치하여 발음 듣기</div>
        </div>
        <div class="choice-container">
            ${choices.map(c => `<button class="choice-btn" onclick="checkAnswer(this, ${c.id === item.id}, '${item.id}')">${c.meaning}</button>`).join('')}
        </div>
    `;
}

async function checkAnswer(btn, isCorrect, id) {
    const btns = document.querySelectorAll('.choice-btn');
    btns.forEach(b => b.disabled = true);

    if (isCorrect) {
        btn.classList.add('correct');
        localStorage.setItem(`mission_${id}`, 'true');
        if (window.toss && typeof toss.vibrate === 'function') toss.vibrate('success');
        
        // 정답 시 광고 카운트 체크
        await showInterstitialAd();

        setTimeout(() => {
            currentCardIndex++;
            renderQuiz();
        }, 1200);
    } else {
        btn.classList.add('error');
        saveWrongNote(id);
        if (window.toss && typeof toss.vibrate === 'function') toss.vibrate('error');
        setTimeout(() => {
            btns.forEach(b => { b.classList.remove('error'); b.disabled = false; });
        }, 1000);
    }
}

/**
 * [5. UI 렌더링]
 */
function renderCategories() {
    const list = document.getElementById('category-list');
    list.innerHTML = Object.keys(DB.scenes).map(cat => `
        <div class="card" onclick="startCategoryQuiz('${cat}')">
            <div style="font-size:24px; margin-right:15px;">📍</div>
            <div>
                <div style="font-weight:800; font-size:17px;">${cat}</div>
                <div style="font-size:13px; color:var(--text-sub); margin-top:2px;">${DB.scenes[cat].length}개 문장 학습하기</div>
            </div>
        </div>
    `).join('');

    const wordList = document.getElementById('word-category-list');
    const wordCats = [
        { name: '히라가나', icon: 'あ', data: 'hiragana' },
        { name: '가타카나', icon: 'ア', data: 'katakana' },
        { name: '숫자/단위', icon: '1️⃣', data: 'numbers' },
        { name: '날짜/요일', icon: '📅', data: 'days' }
    ];
    wordList.innerHTML = wordCats.map(cat => `
        <div class="card" onclick="alert('단어 퀴즈 모드는 준비 중입니다! 문장 학습을 먼저 이용해주세요.')">
            <div style="font-size:24px; margin-right:15px;">${cat.icon}</div>
            <div>
                <div style="font-weight:800; font-size:17px;">${cat.name}</div>
                <div style="font-size:13px; color:var(--text-sub); margin-top:2px;">기초 필수 암기</div>
            </div>
        </div>
    `).join('');
}

function updateJourney() {
    const doneTotal = DB.sentences.filter(s => localStorage.getItem(`mission_${s.id}`)).length;
    const percent = Math.round((doneTotal / DB.sentences.length) * 100) || 0;
    document.getElementById('total-percent').innerText = `${percent}% 정복`;
    document.getElementById('total-bar').style.width = `${percent}%`;
    document.getElementById('total-count').innerText = `전체 ${doneTotal} / ${DB.sentences.length} 문장 완료`;
    
    const journeyList = document.getElementById('journey-category-list');
    journeyList.innerHTML = Object.keys(DB.scenes).map(cat => {
        const ids = DB.scenes[cat];
        const done = ids.filter(id => localStorage.getItem(`mission_${id}`)).length;
        const p = Math.round((done / ids.length) * 100) || 0;
        return `
            <div class="card" style="flex-direction:column; align-items:flex-start; cursor:default;">
                <div style="display:flex; justify-content:space-between; width:100%; font-weight:800; margin-bottom:8px;">
                    <span>${cat}</span><span>${p}%</span>
                </div>
                <div class="chart-bar-bg" style="width:100%;"><div class="chart-bar-fill" style="width:${p}%"></div></div>
            </div>`;
    }).join('');
}

function handleBack() {
    history.back();
}

window.onload = () => {
    history.replaceState({ view: 'home' }, '', ''); 
    loadData();
    if (window.toss && typeof toss.init === 'function') toss.init();
    loadBannerAd(); // 배너 로드
};