const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const database = require('./database.json');
const resultsFileName = path.resolve(__dirname, './results.csv');
const databasePath = path.resolve(__dirname, './database.json');

main();

async function main() {
  const week = 1;
  const useDb = false;
  !useDb && prepareFile();
  const browser = await puppeteer.launch();
  try {
    const page = await goToPage(browser, `https://www.espn.com/nfl/scoreboard/_/year/2019/seasontype/2/week/${week}`);
    const games = await page.$$('div.scoreboard-top.no-tabs');
    for (const game of games) {
      const home = await game.$('tr.home');
      const away = await game.$('tr.away');
      const info = {
        home: {
          names: await getNames(home),
          scores: await getScores(home),
        },
        away: {
          names: await getNames(away),
          scores: await getScores(away),
        },
        week,
      }
      const homeTeam = info.home.names.shortName;
      const awayTeam = info.away.names.shortName;
      const skip = useDb && database[homeTeam] && database[homeTeam][week] && database[awayTeam] && database[awayTeam][week];
      if (skip) {
        console.log(`Skipping ${awayTeam} vs ${homeTeam}.`);
        continue;
      }
      const spreadLink = await game.$eval('.mobileScoreboardLink', node => node.href);
      const oddsInfo = await getOddsInfo(browser, spreadLink);
      console.log(`Writing results for ${awayTeam} vs ${homeTeam} game.`);
      loadResults(info, oddsInfo);
      dbWrite(homeTeam, week, database);
      dbWrite(awayTeam, week, database);
    }
  } catch (err) {
    console.error(err);
  }
  fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));
  console.log('ALL DONE');
  await browser.close();
}

function prepareFile() {
  const columns = [
    'Week',
    'Team Abbrev',
    'Team Name',
    'Opponent Abrrev',
    'Opponent Name', 
    'Home', 
    'Quarterly Points For',
    'Total Points For',
    'Quarterly Points Against',
    'Total Points Against',
    'Line',
    'O/U',
    'Line Cover?',
    'O/U?',
  ].join(', ');
  fs.writeFileSync(resultsFileName, columns + '\n');
}

function dbWrite(team, week, database) {
  if (!database[team]) {
    database[team] = {};
  }
  database[team][week] = 1;
}

async function getOddsInfo(browser, link) {
  const page = await goToPage(browser, link);
  const oddsElement = await page.$('div.odds-details');
  if (!oddsElement) {
    await page.close();
    return '';
  }
  const info = await oddsElement.$$eval('li', nodes => nodes.map(node => {
    const text = node.textContent || '';
    const num = text.split(':')[1] || '';
    return num.trim();
  }));
  await page.close();
  return info;
}

function loadResults(info, odds) {
  addToResults(info.week, info.home, info.away, true, odds);
  addToResults(info.week, info.away, info.home, false, odds);
}

function overUnder(score1, score2, ou) {
  if (!ou) {
    return;
  }
  const total = score1 + score2;
  ou = parseInt(ou, 10);
  if (total < ou) {
    return 'Under';
  } else if (total > ou) {
    return 'Over';
  }
  return 'Push';
}

function coverSpread(score1, score2, line, favorite) {
  if (!line) {
    return;
  }
  const info = line.split(' ');
  const team = info[0];
  line = parseInt(info[1], 10);
  if (team === favorite) {
    const diff = score1 + line - score2;
    if (diff === 0) {
      return 'Push';
    }
    return diff > 0;
  }
  const diff = score2 + line - score1;
  if (diff === 0) {
    return 'Push';
  }
  return diff < 0;
}

function addToResults(week, team1, team2, home, odds) {
  const ou = parseInt
  const results = [
    week,
    team1.names.shortName,
    team1.names.fullName,
    team2.names.shortName,
    team2.names.fullName,
    home,
    team1.scores.quarterly.join(' '),
    team1.scores.total,
    team2.scores.quarterly.join(' '),
    team2.scores.total,
    odds,
    coverSpread(team1.scores.total, team2.scores.total, odds[0], team1.names.shortName),
    overUnder(team1.scores.total, team2.scores.total, odds[1]),
  ].join(', ') + '\n';
  fs.appendFileSync(resultsFileName, results);
}

async function goToPage(browser, uri) {
  let attempts = 0;
  while (attempts++ < 3) {
    const page = await browser.newPage();
    try {
    //   await page.authenticate({ username: 'longba', password: 'SepOct2019**' });
      console.log(`Navigating to ${uri}`);
      await page.goto(uri);
      console.log('Done navigating');
      return page;
    } catch (err) {
      console.warn(`Retrying request to ${uri}`);
    }
    console.log('Closing page');
    await page.close();
  }
  throw new Error(`Cannot navigate to ${uri}`);
}

async function getNames(element) {
  return {
    fullName: await getTextValue(element, 'span.sb-team-short'),
    shortName: await getTextValue(element, 'span.sb-team-abbrev'),
  }
}

async function getScores(element) {
  return getTextValues(element, 'td.score');
}

function getTextValue(element, selector) {
  return element.$eval(selector, node => node.textContent);
}

async function getTextValues(element, selector) {
  const quarterly = await element.$$eval(selector, nodes => nodes.map(node => parseInt(node.textContent, 10)));
  return {
    quarterly,
    total: quarterly.reduce((total, num) => total + num, 0),
  }
}