'use strict';

const chalk = require('chalk');
const clear = require('clear');
const CLI = require('clui');
const figlet = require('figlet');
const inquirer = require('inquirer');
const Preferences = require('preferences');
const Spinner = CLI.Spinner;
const GitHubApi = require('github');
const _ = require('lodash');
const git = require('simple-git')();
const touch = require('touch');
const fs = require('fs');

const files = require('./lib/files');

const github = new GitHubApi({
    version: '3.0.0'
});

clear();
console.log(
    chalk.yellow(
        figlet.textSync('Ginit', {
            horizontalLayout: 'full'
        })
    )
);

if (files.directoryExists('.git')) {
    console.log(chalk.red('Aleardy a git repository!'));
    process.exit();
}

function getGithubCredentials(callback) {
    let questions = [{
        name: 'username',
        type: 'input',
        message: 'Enter your Github username or e-mail address:',
        validate: function(value) {
            if (value.length) {
                return true;
            } else {
                return 'Please enter your username or e-mail address';
            }
        }
    }, {
        name: 'password',
        type: 'password',
        message: 'Enter your password:',
        validate: function(value) {
            if (value.length) {
                return true;
            } else {
                return 'Please enter your password';
            }
        }
    }];
    inquirer.prompt(questions).then(callback);
}

function getGithubToken(callback) {
    const prefs = new Preferences('ginit');

    if (prefs.github && prefs.github.token) {
        return callback(null, prefs.github.token);
    }
    // Fetch token
    getGithubCredentials((credentials) => {
        const status = new Spinner('Authenticating you, please wait...');
        status.start();
        github.authenticate(
            _.extend({
                type: 'basic'
            }, credentials)
        );
        github.authorization.create({
            scopes: ['user', 'public_repo', 'repo', 'repo:status'],
            note: 'gitnit, the command-line tool for initializing Git repos'
        }, (err, res) => {
            status.stop();
            if (err) {
                return callback(err);
            }
            if (res.token) {
                prefs.github = {
                    token: res.token
                };
                return callback(null, res.token);
            }
            return callback();
        });
    });
}

function createRepo(callback) {
    const argv = require('minimist')(process.argv.slice(2));

    const questions = [{
        type: 'input',
        name: 'name',
        message: 'Enter a name for repository:',
        default: argv._[0] || files.getCurrentDirectoryBase(),
        validate: function(value) {
            if (value.length) {
                return true;
            } else {
                return 'Please enter a name for the repository';
            }
        }
    }, {
        type: 'input',
        name: 'description',
        default: argv._[1] || null,
        message: 'Optionally enter a description of the repository:'
    }, {
        type: 'list',
        name: 'visibility',
        message: 'Public or private:',
        choices: ['public', 'private'],
        default: 'public'
    }];
    inquirer.prompt(questions).then((answers) => {
        const status = new Spinner('Creating repository...');
        status.start();

        const data = {
            name: answers.name,
            description: answers.description,
            private: (answers.visibility === 'private')
        };

        github.repos.create(data, (err, res) => {
            status.stop();
            if (err) {
                return callback(err);
            }
            return callback(null, res.ssh_url);
        });
    });
}

function createGitinore(callback) {
    const fileList = _.without(fs.readdirSync('.'), '.git', '.gitignore');
    if (fileList.length) {
        const questions = [{
            type: 'checkbox',
            name: 'ignore',
            message: 'select the files and/or folders you wish to ignore:',
            choices: fileList,
            default: ['node_modules', 'bower_components']
        }];
        inquirer.prompt(questions).then((answers) => {
            if (answers.ignore.length) {
                fs.writeFileSync('.gitignore', answers.ignore.join('\n'));
            } else {
                touch('.gitignore');
            }
            return callback();
        });
    } else {
        touch('.gitignore');
        return callback();
    }
}

function setupRepo(url, callback) {
    const status = new Spinner('Setting up the repository...');
    status.start();

    git
        .init()
        .add('.gitignore')
        .add('./*')
        .commit('Initial commit')
        .addRemote('origin', url)
        .push('origin', 'master')
        .then(function() {
            status.stop();
            return callback();
        });
}

function githubAuth(callback) {
    getGithubToken((err, token) => {
        if (err) {
            return callback(err);
        }
        github.authenticate({
            type: 'oauth',
            token: token
        });
        return callback(null, token);
    });
}

githubAuth((err, authed) => {
    if (err) {
        switch (err.code) {
            case 401:
                console.log(chalk.red('Couldn\'t log you in. Please try again'));
                break;
            case 422:
                console.log(chalk.red('You aleardy have an access token.'));
                break;
        }
    }
    if (authed) {
        console.log(chalk.green('Successfully authenticated!'));
        createRepo((err, url) => {
            if (err) {
                console.log(chalk.red('an error had occured'));
            }
            if (url) {
                createGitinore(() => {
                    setupRepo(url, (err) => {
                        if (!err) {
                            console.log(chalk.green('All Done!'));
                        }
                    });
                });
            }
        });
    }
});
