import { ConsoleLogger, type LogLevel } from '@nestjs/common';

import { maskeerDiep, maskeerToken } from './token-maskering';

/**
 * Logger die leverancierstokens onherkenbaar maakt vóórdat er iets wordt
 * weggeschreven.
 *
 * Zie ontwerp §7. Dit is een vangnet op de laatste plek waar het nog kan:
 * losse `Logger`-aanroepen kunnen we controleren bij code review, maar de
 * URL's die NestJS zelf logt bij een onafgevangen fout niet.
 *
 * Bewust op logger-niveau en niet per aanroepplek: een maskering die je bij
 * elke logregel handmatig moet toepassen, wordt een keer vergeten.
 */
export class MaskerendeLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
  ): void {
    super.printMessages(
      messages.map((m) => maskeerDiep(m)),
      context,
      logLevel,
      writeStreamType,
    );
  }

  protected formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    return maskeerToken(
      super.formatMessage(
        logLevel,
        message,
        pidMessage,
        formattedLogLevel,
        contextMessage,
        timestampDiff,
      ),
    );
  }
}
