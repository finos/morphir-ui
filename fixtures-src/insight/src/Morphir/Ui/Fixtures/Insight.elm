module Morphir.Ui.Fixtures.Insight exposing (..)

{-| Purpose-built fixture for morphir-ui's insight visualization tests.
Each definition targets one transform behavior; names are load-bearing
(referenced verbatim from tests in @morphir/ir and @morphir/insight).
-}


type Color
    = Red
    | Green
    | Blue


type alias Person =
    { name : String
    , age : Int
    }


chainedArithmetic : Int -> Int -> Int -> Int
chainedArithmetic a b c =
    a + b + c


mixedPrecedence : Int -> Int -> Int -> Int
mixedPrecedence a b c =
    (a + b) * c


safeDivide : Float -> Float -> Float
safeDivide n d =
    n / (d + 1)


boolChain : Bool -> Bool -> Bool -> Bool
boolChain p q r =
    p && q && r || not p


comparison : Int -> Int -> Bool
comparison a b =
    a <= b


gradeIf : Int -> String
gradeIf score =
    if score >= 90 then
        "A"

    else if score >= 80 then
        "B"

    else if score >= 70 then
        "C"

    else
        "F"


maybeCase : Maybe Int -> Int
maybeCase m =
    case m of
        Just x ->
            x

        Nothing ->
            0


colorCase : Color -> String
colorCase color =
    case color of
        Red ->
            "warm"

        Green ->
            "natural"

        Blue ->
            "cool"


tupleCase : ( Int, Bool ) -> String
tupleCase pair =
    case pair of
        ( 0, True ) ->
            "zero-true"

        ( _, False ) ->
            "any-false"

        _ ->
            "other"


nestedCase : Color -> Maybe Int -> String
nestedCase color m =
    case color of
        Red ->
            case m of
                Just _ ->
                    "red-some"

                Nothing ->
                    "red-none"

        _ ->
            "not-red"


letBound : Int -> Int
letBound x =
    let
        doubled =
            x * 2

        offset =
            doubled + 1
    in
    offset


applyPipeline : List Int -> List Int
applyPipeline xs =
    List.map (\x -> x + 1) (List.filter (\x -> x > 0) xs)


personRecord : Person
personRecord =
    { name = "Ada", age = 36 }


updatedPerson : Person -> Person
updatedPerson p =
    { p | age = p.age + 1 }


applyLambda : Int -> Int
applyLambda x =
    (\y -> y * y) x


negated : Int -> Int
negated x =
    negate x


powered : Float -> Float
powered x =
    x ^ 2


memberOf : Color -> Bool
memberOf c =
    List.member c [ Red, Blue ]


helperFn : Int -> Int
helperFn x =
    x + 1


usesHelper : Int -> Int
usesHelper x =
    helperFn (x * 2)


selfRecursive : Int -> Int
selfRecursive n =
    if n <= 0 then
        0

    else
        selfRecursive (n - 1)


leftSubtraction : Int -> Int -> Int -> Int
leftSubtraction a b c =
    a - b - c


rightSubtraction : Int -> Int -> Int -> Int
rightSubtraction a b c =
    a - (b - c)
