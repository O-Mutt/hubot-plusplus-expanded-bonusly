// Description:
//   Integration point between hubot-plusplus-expanded and bonusly' api
//
//
// Configuration:
//   MONGO_URI: URI for the mongo database
//   BONUSLY_API_KEY: Api key for connecting to the bonusly api
//
// Commands:
//   change my bonusly configuration - used to change the config on when bonusly points are sent after a
//     hubot point
// Event-Listener:
//   plus-plus - Listens for this to send points
//
// Author: O-Mutt

const Conversation = require('hubot-conversation');

const { BonuslyResponse } = require('./lib/service/BonuslyResponseEnum');
const UserService = require('./lib/service/UserService');
const BonuslyService = require('./lib/service/BonuslyService');
const Helpers = require('./lib/helpers');

module.exports = function (robot) {
  const procVars = Helpers.createProcVars(process.env);

  const userService = new UserService(robot, procVars);
  const bonuslyService = new BonuslyService(robot, procVars);

  if (!procVars.bonuslyApiKey) {
    robot.logger.error('hubot-plusplus-expanded-bonusly is installed but the bonusly api key is not configured');
    return;
  }

  robot.on('plus-plus', handlePlusPlus);
  robot.on('plus-plus-bonusly-sent', handleBonuslySent);
  robot.respond(/.*change.*bonusly\s?(?:integration)?\s?(?:configuration|config|response|setting|settings).*/ig, changeBonuslyConfig);
  robot.respond(/.*change.*bonusly.*(points|amount).*/ig, changeBonuslyAmount);
  robot.respond(/.*toggle dm about bonusly.*/ig, toggleBonuslyDM);

  async function changeBonuslyConfig(msg) {
    const switchBoard = new Conversation(robot);
    if (msg.message.room[0] !== 'D' && msg.message.room !== 'Shell') {
      msg.reply(`Please use this function of ${robot.name} in DM.`);
      return;
    }

    const user = await userService.getUser(msg.message.user.id);
    if (!user) {
      msg.reply('I\'m sorry we could not find your user account. Please contact an admin');
      return;
    }

    const dialog = switchBoard.startDialog(msg);
    let choiceMsg = `${robot.name} is setup to allow you to also send a Bonusly point when you send a ${robot.name} point! `;
    choiceMsg += `There are three options how you can setup ${robot.name} to do this:`;
    choiceMsg += `\n• Always send a bonusly when you send a ${robot.name} point.\n • Prompt every time to send a ${robot.name} point to include a Bonusly point.\n • Never include a Bonusly point with ${robot.name} points.`;
    choiceMsg += `\n\nHow would you like to configure ${robot.name}? (You can always change this later by DMing me \`change my bonusly settings\`)\n[ \`Always\` | \`Prompt\` | \`Never\` ]`;
    robot.messageRoom(user.slackId, choiceMsg);
    dialog.addChoice(/always/i, async () => {
      await userService.setBonuslyResponse(user, BonuslyResponse.ALWAYS);
      msg.reply(`Thank you! We've updated your ${robot.name}->bonusly integration settings`);
    });
    dialog.addChoice(/prompt/i, async () => {
      await userService.setBonuslyResponse(user, BonuslyResponse.PROMPT);
      msg.reply(`Thank you! We've updated your ${robot.name}->bonusly integration settings`);
    });
    dialog.addChoice(/never/i, async () => {
      await userService.setBonuslyResponse(user, BonuslyResponse.NEVER);
      msg.reply(`Thank you! We've updated your ${robot.name}->bonusly integration settings`);
    });
  }

  async function changeBonuslyAmount(msg) {
    const switchBoard = new Conversation(robot);
    if (msg.message.room[0] !== 'D' && msg.message.room !== 'Shell') {
      msg.reply(`Please use this function of ${robot.name} in DM.`);
      return;
    }

    const user = await userService.getUser(msg.message.user.id);
    if (!user) {
      msg.reply('I\'m sorry we could not find your user account. Please contact an admin');
      return;
    }

    const dialog = switchBoard.startDialog(msg);
    let choiceMsg = `${robot.name} is setup to allow you to also send Bonusly point(s) when you send a ${robot.name} point!\n`;
    choiceMsg += `Currently you are set to send *${user.bonuslyAmount || 1}* point(s). Respond with a number to change this amount.`;
    robot.messageRoom(user.slackId, choiceMsg);
    dialog.addChoice(/(?<amount>[0-9]+)/i, async (msg2) => {
      const amount = parseInt(msg2.match.groups.amount || 1, 10);
      await userService.setBonuslyAmount(user, amount);
      msg.reply(`Thank you! We've updated your ${robot.name}->bonusly amount to *${amount}*`);
    });
  }

  async function toggleBonuslyDM(msg) {
    if (msg.message.room[0] !== 'D' && msg.message.room !== 'Shell') {
      msg.reply(`Please use this function of ${robot.name} in DM.`);
      return;
    }

    let user = await userService.getUser(msg.message.user.id);
    if (!user) {
      msg.reply('I\'m sorry we could not find your user account. Please contact an admin');
      return;
    }

    await userService.toggleBonuslyDM(user);
    user = await userService.getUser(msg.message.user.id);
    msg.reply(`Thank you! We've updated your ${robot.name}->bonusly DM config. ${user.bonuslyDM ? `${robot.name} will DM you again.` : `${robot.name} won't DM you any more.`}`);
  }
  /**
   * The event that was emitted by the plus-plus module for a user
   * (https://github.com/O-Mutt/hubot-plusplus-expanded/blob/main/src/plusplus.js#L270-L277)
   * @param {object} event the base event object
   * @param {string} event.notificationMessage the string that represents the event
   * @param {object} event.sender the sender (from) of the point
   * @param {object} event.recipient the recipient (to) of the point
   * @param {string} event.direction the direction of the point (e.g. '++' or '--')
   * @param {string} event.room the room the point was sent in
   * @param {string} event.cleanReason the clean (and encoded) reason for the point was sent
   * @param {object} event.msg the msg from hubot that the event originated from
   * @returns
   */
  async function handlePlusPlus(event) {
    const switchBoard = new Conversation(robot);
    if (event.direction !== '++' && event.direction !== '+') {
      robot.logger.debug(`Points were taken away, not given. We won't talk to bonusly for this one.\n${JSON.stringify(event.direction)}`);
      return;
    }

    if (!event.sender.slackEmail || !event.recipient.slackEmail) {
      const message = `<@${event.sender.slackId}> is trying to send to <@${event.recipient.slackId}> but the one of the emails are missing. Sender: [${event.sender.slackEmail}], Recipient: [${event.recipient.slackEmail}]`;
      robot.logger.error(message);
      robot.emit('plus-plus-failure', {
        notificationMessage: `${message} in <#${event.room}>`,
        room: event.room,
      });
      return;
    }

    const { bonuslyAmount = 1 } = await userService.getUser(event.sender.slackId);
    event.amount = bonuslyAmount;
    const msg = {
      message: {
        user: {
          id: event.sender.slackId,
        },
      },
    };

    if (!event.sender.bonuslyResponse) {
      const dialog = switchBoard.startDialog(msg);
      dialog.dialogTimeout = () => {
        robot.messageRoom(event.sender.slackId, 'We didn\'t receive your response in time. Please try again.');
      };
      // check with user how they want to handle hubot points/bonusly bonuses
      let choiceMsg = `${robot.name} is setup to allow you to also send a Bonusly point when you send a ${robot.name} point! `;
      choiceMsg += `There are three options how you can setup ${robot.name} to do this:`;
      choiceMsg += `\n• Always send a bonusly when you send a ${robot.name} point.\n • Prompt every time to send a ${robot.name} point to include a Bonusly point.\n • Never include a Bonusly point with ${robot.name} points.`;
      choiceMsg += `\n\nHow would you like to configure ${robot.name}? (You can always change this later by DMing me \`change my bonusly settings\`)\n[ \`Always\` | \`Prompt\` | \`Never\` ]`;
      robot.messageRoom(event.sender.slackId, choiceMsg);
      dialog.addChoice(/always/i, async () => {
        await userService.setBonuslyResponse(event.sender, BonuslyResponse.ALWAYS);
        const response = await bonuslyService.sendBonus(event);
        robot.emit('plus-plus-bonusly-sent', { response, event });
      });
      dialog.addChoice(/prompt/i, async () => {
        await userService.setBonuslyResponse(event.sender, BonuslyResponse.PROMPT);
        robot.messageRoom(event.sender.slackId, `In that case, do you want to send <@${event.recipient.slackId}> a Bonusly worth ${event.amount}?\n[ \`Yes\` | \`No\` ]`);
        dialog.addChoice(/yes/i, async () => {
          const response = await bonuslyService.sendBonus(event);
          robot.emit('plus-plus-bonusly-sent', { response, event });
        });
        dialog.addChoice(/no/i, async () => {
          robot.messageRoom(event.sender.slackId, 'Ah, alright. Next time!');
        });
      });
      dialog.addChoice(/never/i, async () => {
        await userService.setBonuslyResponse(event.sender, BonuslyResponse.NEVER);
        robot.messageRoom(event.sender.slackId, 'Alright! No worries. If you ever change your mind we can change your mind just let me know (DM me `change my bonusly settings`)!');
      });
      return;
    }

    if (event.sender.bonuslyResponse === BonuslyResponse.ALWAYS) {
      const response = await bonuslyService.sendBonus(event);
      robot.emit('plus-plus-bonusly-sent', { response, event });
    } else if (event.sender.bonuslyResponse === BonuslyResponse.PROMPT) {
      const dialog = switchBoard.startDialog(msg);
      dialog.dialogTimeout = () => {
        robot.messageRoom(event.sender.slackId, 'We didn\'t receive your response in time. Please try again.');
      };
      robot.messageRoom(event.sender.slackId, `You just gave <@${event.recipient.slackId}> a ${robot.name} point and Bonusly is enabled, would you like to send them ${event.amount} point(s) on Bonusly as well?\n[ \`Yes\` | \`No\` ]`);
      dialog.addChoice(/yes/i, async () => {
        const response = await bonuslyService.sendBonus(event);
        robot.emit('plus-plus-bonusly-sent', { response, event });
      });
      dialog.addChoice(/no/i, () => {
        robot.messageRoom(event.sender.slackId, 'Ah, alright. Next time!');
      });
    }
  }

  async function handleBonuslySent(e) {
    if (e.response.success === true) {
      robot.logger.debug('bonusly point was sent and we caught the event.');
      const bonuslyMessage = `We sent a Bonusly for ${e.response.result.amount_with_currency} to <@${e.event.recipient.slackId}>.`;
      const user = await userService.getUser(e.event.sender.slackId);
      if (user.bonuslyDM === true || user.bonuslyDM === undefined) {
        let dm = `We sent <@${e.event.recipient.slackId}> ${e.response.result.amount_with_currency} via Bonusly. You now have ${e.response.result.giver.giving_balance_with_currency} left.`;
        if ((!user.bonuslyAmount || e.event.amount === 1) && Helpers.rngBoolean()) {
          dm += `\n\nDid you know you could change the amount you send per ${robot.name} Point?\n Just DM @${robot.name} \`change my bonusly points setting\`,`;
          dm += '\nI will ask you about how many points you\'d like to send per `++` you respond with a number.\n :tada: Bingo Bango Bongo, you\'re all set.';
        }
        if (user.bonuslyDM === undefined && Helpers.rngBoolean()) {
          dm += `\n\nDon't like these DMs about bonusly?\nJust DM @${robot.name} \`toggle dm about bonusly\` and we will turn off this DM.`;
        }
        robot.messageRoom(e.event.sender.slackId, dm);
      }
      e.event.msg.send(bonuslyMessage);
    } else {
      robot.logger.error('there was an issue sending a bonus', e.response.message);
      e.event.msg.send(`Sorry, there was an issue sending your bonusly bonus: ${e.response.message}`);
    }
  }
};
