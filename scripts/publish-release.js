require('colors').setTheme({
    verbose: 'cyan',
    warn: 'yellow',
    error: 'red',
});

const fs = require("fs");
const path = require("path");
const https = require('https');
const { Octokit } = require("@octokit/rest");
const execa = require('execa');
const inquirer = require('inquirer');
const git = require('simple-git/promise')();
const package = require('../package.json');

require('dotenv').config();

const isDryRun = process.argv.indexOf('--dry-run') > 1;
const commitMessage = `release: ${package.version} :tada:`;
const tagName = `v${package.version}`;
const files = [
    path.join(__dirname, '..', 'archives', `bbb-v${package.version}.tar.gz`),
    path.join(__dirname, '..', 'archives', `bbb-v${package.version}.tar.gz.asc`),
    path.join(__dirname, '..', 'archives', `bbb-v${package.version}.tar.gz.ncsig`),
    path.join(__dirname, '..', 'archives', `bbb-v${package.version}.tar.gz.sig`),
];

function pull() {
    return git.pull('origin', 'master');
}

async function notAlreadyTagged() {
    if ((await git.tags()).all.includes(tagName)) {
        throw 'version already tagged';
    }
}

async function lastCommitNotBuild() {
    return (await git.log(['-1'])).latest.message !== commitMessage;
}

async function isMasterBranch() {
    return (await git.branch()) === 'master';
}

async function generateChangelog() {
    const latestTag = (await git.tags()).latest;
    const title = `v${package.version}` === latestTag ? '[Unreleased]' : `${package.version} (${new Date().toISOString().split('T')[0]})`;

    const logs = await git.log({
        from: latestTag,
        to: 'HEAD'
    });

    const sections = [{
        type: 'feat',
        label: 'Added',
    }, {
        type: 'fix',
        label: 'Fixed',
    }];

    const entries = {};

    logs.all.forEach(log => {
        let [, type, scope, description] = log.message.match(/^([a-z]+)(?:\((\w+)\))?: (.+)/);
        let entry = { type, scope, description, issues: [] };

        if(log.body) {
            const matches = log.body.match(/(?:fix|fixes|closes?|refs?) #(\d+)/g) || [];

            for (let match of matches) {
                const [, number] = match.match(/(\d+)$/);

                entry.issues.push(number);
            }
        }

        if (!entries[type]) {
            entries[type] = [];
        }

        entries[type].push(entry);
    });

    let changeLog = `## ${title}\n`;

    function stringifyEntry(entry) {
        let issues = entry.issues.map(issue => {
            return `[#${issue}](https://github.com/sualko/cloud_bbb/issues/${issue})`;
        }).join('');
        return `- ${issues} ${entry.description}\n`;
    }

    sections.forEach(section => {
        if (!entries[section.type]) {
            return;
        }

        changeLog += `### ${section.label}\n`;

        entries[section.type].forEach(entry => {
            changeLog += stringifyEntry(entry);
        });

        delete entries[section.type];

        changeLog += `\n`
    });

    const miscKeys = Object.keys(entries);

    if (miscKeys && miscKeys.length > 0) {
        changeLog += `### Misc\n`;

        miscKeys.forEach(type => {
            entries[type].forEach(entry => {
                changeLog += stringifyEntry(entry);
            });
        })
    }

    return changeLog;
}

function hasChangeLogEntry() {
    return new Promise(resolve => {
        fs.readFile(path.join(__dirname, '..', 'CHANGELOG.md'), function (err, data) {
            if (err) throw err;

            if (!data.includes(`## ${package.version}`)) {
                throw `Found no change log entry for ${package.version}`;
            }

            resolve();
        });
    });
}

async function commitChangeLog() {
    let status = await git.status();

    if (status.staged.length > 0) {
        throw 'Repo not clean. Found staged files.';
    }

    if (!isDryRun) {
        await git.add('CHANGELOG.md');
        await git.commit('docs: update change log', ['-n']);
    }
}

async function hasArchiveAndSignatures() {
    return files.map(file => fs.existsSync(file)).indexOf(false) < 0;
}

async function stageAllFiles() {
    if (isDryRun) {
        return;
    }

    let gitProcess = execa('git', ['add', '-u']);

    gitProcess.stdout.pipe(process.stdout);

    return gitProcess;
}

function showStagedDiff() {
    let gitProcess = execa('git', ['diff', '--staged']);

    gitProcess.stdout.pipe(process.stdout);

    return gitProcess;
}

async function keypress() {
    return inquirer.prompt([{
        type: 'input',
        name: 'keypress',
        message: 'Press any key to continue... (where is the any key?)',
    }]);
}

function commit() {
    if (isDryRun) {
        return;
    }

    return git.commit(commitMessage, ['-S', '-n']);
}

async function wantToContinue(message) {
    let answers = await inquirer.prompt([{
        type: 'confirm',
        name: 'continue',
        message,
        default: false,
    }]);

    if (!answers.continue) {
        process.exit(10);
    }
}

function push() {
    if (isDryRun) {
        return;
    }

    return git.push('origin', 'master');
}

async function createGithubRelease(changeLog) {
    if (!process.env.GITHUB_TOKEN) {
        throw 'Github token missing'
    }

    const octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN,
        userAgent: 'custom releaser for sualko/cloud_bbb',
    });

    let origin = (await git.remote(['get-url', 'origin'])).trim();
    let matches = origin.match(/^git@github\.com:(.+)\/(.+)\.git$/);

    if (!matches) {
        throw 'Origin is not configured or no ssh url';
    }

    const owner = matches[1];
    const repo = matches[2];
    const releaseOptions = {
        owner,
        repo,
        tag_name: tagName,
        name: tagName,
        body: changeLog,
        draft: true,
        prerelease: !/^\d+\.\d+\.\d+$/.test(package.version),
    };

    if (isDryRun) {
        console.log('github release options', releaseOptions);
        return [];
    }

    let releaseResponse = await octokit.repos.createRelease(releaseOptions);

    console.log(`Draft created, see ${releaseResponse.data.html_url}`.verbose);

    function getMimeType(filename) {
        if (filename.endsWith('.asc') || filename.endsWith('sig')) {
            return 'application/pgp-signature';
        }

        if (filename.endsWith('.tar.gz')) {
            return 'application/gzip';
        }

        if (filename.endsWith('.ncsig')) {
            return 'text/plain';
        }

        return 'application/octet-stream';
    }

    let assetUrls = [];

    files.forEach(async file => {
        const filename = path.basename(file);
        const uploadOptions = {
            owner,
            repo,
            release_id: releaseResponse.data.id,
            data: fs.createReadStream(file),
            headers: {
                'content-type': getMimeType(filename),
                'content-length': fs.statSync(file)[size],
            },
            name: filename,
        };

        let assetResponse = await octokit.repos.uploadReleaseAsset(uploadOptions);

        console.log(`Asset uploaded: ${assetResponse.data.name}`.verbose);

        assetUrls.push(assetResponse.data.browser_download_url);
    });

    return assetUrls;
}

async function uploadToNextcloudStore(archiveUrl) {
    if(!process.env.NEXTCLOUD_TOKEN) {
        throw 'Nextcloud token missing';
    }

    const hostname = 'apps.nextcloud.com';
    const apiEndpoint = '/api/v1/apps/releases';
    const signatureFile = files.find(file => file.endsWith('.ncsig'));
    const data = JSON.stringify({
        download: archiveUrl,
        signature: fs.readFileSync(signatureFile, 'utf-8'),
        nightly: false,
    });
    const options = {
        hostname,
        port: 443,
        path: apiEndpoint,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            'Authorization': `Token ${process.env.NEXTCLOUD_TOKEN}`,
        }
    };

    if (isDryRun) {
        console.log('nextcloud app store request', options, data);
        return;
    }

    return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
            if (res.statusCode === 200) {
                console.log('App release was updated successfully'.verbose);
                resolve();
            } else if (res.statusCode === 201) {
                console.log('App release was created successfully'.verbose);
                resolve();
            } else if (res.statusCode === 400) {
                reject('App release was not accepted');
            } else {
                reject('App release rejected with status ' + res.statusCode);
            }

            res.on('data', d => {
                process.stdout.write(d)
            })
        })

        req.on('error', error => {
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

async function run() {
    await pull();
    console.log(`✔ pulled latest changes`.green);

    await notAlreadyTagged();
    console.log(`✔ not already tagged`.green);

    await lastCommitNotBuild();
    console.log(`✔ last commit is no build commit`.green);

    await isMasterBranch();
    console.log(`✔ this is the master branch`.green);

    const changeLog = await generateChangelog();
    console.log(changeLog.verbose);
    console.log(`✔ change log generated`.green);

    console.log('Press any key to continue...');
    await keypress();

    await hasChangeLogEntry();
    console.log(`✔ there is a change log entry for this version`.green);

    await commitChangeLog();
    console.log(`✔ change log commited`.green);

    await hasArchiveAndSignatures();
    console.log(`✔ found archive and signatures`.green);

    await stageAllFiles();
    console.log(`✔ all files staged`.green);

    await showStagedDiff();

    await wantToContinue('Should I commit those changes?');

    await commit();
    console.log(`✔ All files commited`.green);

    await wantToContinue('Should I push all pending commits?');

    await push();
    console.log(`✔ All commits pushed`.green);

    await wantToContinue('Should I continue to create a Github release?');

    const assetUrls = await createGithubRelease(changeLog);
    console.log(`✔ released on github`.green);

    const archiveAssetUrl = assetUrls.find(url => url.endsWith('.tar.gz'));

    await wantToContinue('Should I continue to upload the release to the app store?');

    await uploadToNextcloudStore(archiveAssetUrl);
    console.log(`✔ released in Nextcloud app store`.green);
};

run().catch(err => {
    console.log(`✘ ${err.toString()}`.error);
});