export const OPTIONS = 1;
export const LIST = 2;
export const DESCRIBE = 3;
export const SETUP = 4;
export const PLAY = 5;
export const RECORD = 6;
export const TEARDOWN = 7;
// export const GET_PARAMETER = 8;
// export const SET_PARAMETER = 9;

const names =
{
    OPTIONS,
    LIST,
    DESCRIBE,
    SETUP,
    PLAY,
    RECORD,
    TEARDOWN,
    // GET_PARAMETER,
    // SET_PARAMETER,
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
