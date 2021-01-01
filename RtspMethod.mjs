export const OPTIONS = 1;
export const LIST = 2;
export const DESCRIBE = 3;
// export const ANNOUNCE = 4;
export const SETUP = 5;
export const PLAY = 6;
// export const PAUSE = 7;
export const TEARDOWN = 8;
// export const GET_PARAMETER = 9;
// export const SET_PARAMETER = 10;
// export const REDIRECT = 11;
// export const RECORD = 12;

const names =
{
    OPTIONS,
    LIST,
    DESCRIBE,
    // ANNOUNCE,
    SETUP,
    PLAY,
    // PAUSE,
    TEARDOWN,
    // GET_PARAMETER,
    // SET_PARAMETER,
    // REDIRECT,
    // RECORD,
}

export function Name(method)
{
    for(let key in names) {
        if(names[key] === method)
            return key;
    }

    return undefined;
}

export function Parse(token)
{
    if(token.empty)
        return undefined;

    for(let key in names) {
        if(key.length == token.length &&
           token.startsWith(key))
        {
            return names[key];
        }
    }

    return undefined;
}
