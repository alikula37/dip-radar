/** Human-readable vocabulary for the signal codes the API returns. */

export interface SignalVocabularyEntry {
  label: string;
  description: string;
}

export const REASON_INFO: Record<string, SignalVocabularyEntry> = {
  ic: {
    label: 'Factor IC weak',
    description:
      "The score's own rolling information coefficient fell below the strategy's threshold, so the book moved fully to BTC until the factor works again.",
  },
  regime: {
    label: 'Risk-off regime',
    description:
      'The alt/BTC trend or breadth filter is risk-off, so the strategy keeps BTC instead of alt exposure.',
  },
  equity: {
    label: 'Equity brake',
    description: "The strategy's own equity is below its moving average, so exposure was cut.",
  },
  cash: {
    label: 'No candidates',
    description: "No coin passed the strategy's filters at this rebalance, so the book stays in BTC.",
  },
  stop_loss: {
    label: 'Stop loss',
    description: 'The price closed below the stop level set from the entry price.',
  },
  trailing_stop: {
    label: 'Trailing stop',
    description: 'The price closed below the trailing stop that follows the position peak.',
  },
  take_profit: {
    label: 'Take profit',
    description: 'The price closed above the take-profit level set from the entry price.',
  },
  score: {
    label: 'Score faded',
    description: 'The coin stopped being cheap enough: its score fell below the exit threshold.',
  },
  time: {
    label: 'Max holding',
    description: 'The position reached the max-holding limit and returned to BTC.',
  },
  missing: {
    label: 'Price missing',
    description: 'No fresh price for the coin at the rebalance, so the position was closed.',
  },
  rebalance: {
    label: 'Rotated out',
    description: 'The reset-to-top-N rule dropped the coin at this rebalance.',
  },
};

export const ACTION_INFO: Record<string, SignalVocabularyEntry> = {
  BUY: {
    label: 'Buy',
    description: 'A new long position the strategy opened at this rebalance.',
  },
  SELL: {
    label: 'Sell',
    description: 'An exit: the position was closed (see the reason column).',
  },
  SHORT: {
    label: 'Short',
    description: 'A new short position on one of the most expensive coins.',
  },
  HOLD: {
    label: 'Hold',
    description: 'The position stays in the book; nothing to do at this anchor.',
  },
  STAY_IN_BTC: {
    label: 'Move to BTC',
    description: 'The strategy deliberately sits in BTC for this anchor (see the reason).',
  },
  TRACKED: {
    label: 'Tracked',
    description: 'A carried position kept in mind while the book sits in BTC.',
  },
};

export function reasonInfo(reason: string | null | undefined): SignalVocabularyEntry | null {
  if (!reason) return null;
  return REASON_INFO[reason] ?? { label: reason, description: reason };
}

export function actionInfo(action: string): SignalVocabularyEntry {
  return ACTION_INFO[action] ?? { label: action, description: action };
}
