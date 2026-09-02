import { Data } from 'effect'

export class InvalidJson extends Data.TaggedError('InvalidJson')<{ readonly message: string }> {}

export class MissingFormatVersion extends Data.TaggedError('MissingFormatVersion')<{
  readonly message: string
}> {
  static make = () =>
    new MissingFormatVersion({
      message:
        "The IR is in an old format that doesn't have a format version on it. Please regenerate it!",
    })
}

export class UnsupportedFormatVersion extends Data.TaggedError('UnsupportedFormatVersion')<{
  readonly found: number
  readonly message: string
}> {
  static make = (found: number) =>
    new UnsupportedFormatVersion({
      found,
      message:
        found === 1
          ? 'The IR is using format version 1, a legacy format that morphir-ui does not support yet. Please regenerate it with a current morphir-elm!'
          : `The IR is using format version ${found} but this client supports versions 3 and 4. Please regenerate it!`,
    })
}

export class InvalidIr extends Data.TaggedError('InvalidIr')<{ readonly message: string }> {}

export type IrError = InvalidJson | MissingFormatVersion | UnsupportedFormatVersion | InvalidIr
