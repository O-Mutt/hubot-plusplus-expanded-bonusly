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

const { BonuslyResponse } = require('./service/BonuslyResponseEnum');
const UserService = require('./service/UserService');
const BonuslyService = require('./service/BonuslyService');

module.exports = function (robot) {
  const procVars = {};
  procVars.mongoUri = process.env.MONGO_URI || 'mongodb://localhost/plusPlus';
  procVars.bonuslyApiKey = process.env.BONUSLY_API_KEY;
  procVars.bonuslyUri = process.env.BONUSLY_URI;

  const userService = new UserService(robot, procVars);
  const bonuslyService = new BonuslyService(robot, procVars);

  const switchBoard = new Conversation(robot);

  if (!procVars.bonuslyApiKey) {
    robot.logger.error('hubot-plusplus-expanded-bonusly is installed but the bonusly api key is not configured');
    return;
  }

  robot.on('plus-plus', handlePlusPlus);
  robot.respond(/.*change.*bonusly\s?(?:integration)?\s?(?:configuration|config|response|setting|settings).*/ig, changeBonuslyConfig);

  async function changeBonuslyConfig(msg) {
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
    choiceMsg += `\n• Always send a bonusly when you send a ${robot.name} point.\n • Always prompt you to send a Bonusly point.\n • Never include a Bonusly point with ${robot.name} points.`;
    choiceMsg += `\n\nHow would you like to configure ${robot.name}? (You can always change this later!)\n[ \`Always\` | \`Prompt\` | \`Never\` ]`;
    robot.messageRoom(user.slackId, choiceMsg);
    dialog.addChoice(/always/i, async (msg2) => {
      await userService.setBonuslyResponse(user, BonuslyResponse.ALWAYS);
      msg.reply(`Thank you! We've updated your ${robot.name}->bonusly integration settings`);
    });
    dialog.addChoice(/prompt/i, async (msg2) => {
      await userService.setBonuslyResponse(user, BonuslyResponse.PROMPT);
      msg.reply(`Thank you! We've updated your ${robot.name}->bonusly integration settings`);
    });
    dialog.addChoice(/never/i, async (msg2) => {
      await userService.setBonuslyResponse(user, BonuslyResponse.NEVER);
      msg.reply(`Thank you! We've updated your ${robot.name}->bonusly integration settings`);
    });
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
    if (!event.sender.slackEmail || !event.recipient.slackEmail) {
      const message = `<@${event.sender.slackId}> is trying to send to <@${event.recipient.slackId}> but the one of the emails are missing. Sender: [${event.sender.slackEmail}], Recipient: [${event.recipient.slackEmail}]`;
      robot.logger.error(message);
      robot.emit('plus-plus-failure', {
        notificationMessage: `${message} in <#${event.room}>`,
        room: event.room,
      });
      return;
    }

    const msg = {
      message: {
        user: {
          id: event.sender.slackId,
        },
      },
    };
    const dialog = switchBoard.startDialog(msg);
    if (!event.sender.bonuslyResponse) {
      // check with user how they want to handle hubot points/bonusly bonuses
      let choiceMsg = `${robot.name} is setup to allow you to also send a Bonusly point when you send a ${robot.name} point! `;
      choiceMsg += `There are three options how you can setup ${robot.name} to do this:`;
      choiceMsg += `\n• Always send a bonusly when you send a ${robot.name} point.\n • Always prompt you to send a Bonusly point.\n • Never include a Bonusly point with ${robot.name} points.`;
      choiceMsg += `\n\nHow would you like to configure ${robot.name}? (You can always change this later!)\n[ \`Always\` | \`Prompt\` | \`Never\` ]`;
      robot.messageRoom(event.sender.slackId, choiceMsg);
      dialog.addChoice(/always/i, async () => {
        await userService.setBonuslyResponse(event.sender, BonuslyResponse.ALWAYS);
        await bonuslyService.sendBonus(event);
        robot.messageRoom(event.sender.slackId, `We sent a bonusly to <@${event.recipient.slackId}> w/ the ${robot.name} point.`);
      });
      dialog.addChoice(/prompt/i, async () => {
        await userService.setBonuslyResponse(event.sender, BonuslyResponse.PROMPT);
        robot.messageRoom(event.sender.slackId, `In that case, do you want to send <@${event.recipient.slackId}> a Bonusly?\n[\`Yes\`|\`No\`]`);
        dialog.addChoice(/yes/i, async () => {
          await bonuslyService.sendBonus(event);
          robot.messageRoom(event.sender.slackId, `We sent a bonusly to <@${event.recipient.slackId}> w/ the ${robot.name} point.`);
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

    if (event.direction !== '++' && event.direction !== '+') {
      robot.logger.debug(`Points were taken away, not given. We won't talk to bonusly for this one.\n${JSON.stringify(event.direction)}`);
      return;
    }

    if (event.sender.bonuslyResponse === BonuslyResponse.ALWAYS) {
      await bonuslyService.sendBonus(event);
      robot.messageRoom(event.sender.slackId, `We sent a bonusly to <@${event.recipient.slackId}> w/ the ${robot.name} point.`);
    } else if (event.sender.bonuslyResponse === BonuslyResponse.PROMPT) {
      robot.messageRoom(event.sender.slackId, `You just gave <@${event.recipient.slackId}> a ${robot.name} point and Bonusly is enabled, would you like to send them a point on Bonusly as well?\n[ \`Yes\` | \`No\` ]`);
      dialog.addChoice(/yes/i, async () => {
        await bonuslyService.sendBonus(event);
        robot.messageRoom(event.sender.slackId, `We sent a bonusly to <@${event.recipient.slackId}> w/ the ${robot.name} point.`);
      });
      dialog.addChoice(/no/i, () => {
        robot.messageRoom(event.sender.slackId, 'Ah, alright. Next time!');
      });
    }
  }
};
