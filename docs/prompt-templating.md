# Prompt templating

## Selection
By default, the selected text will be added to the end of the prompt.  
Let's say we have selected text `Some example text.` and prompt `You are an assistant helping a user write more content in a document based on a prompt.`

The final prompt will be:
```
You are an assistant helping a user write more content in a document based on a prompt.

Some example text.
```
### Custom place for selection
Use keyword `{{=SELECTION=}}` to insert selected text in different place:
```
{{=SELECTION=}}
You are an assistant helping a user write more content in a document based on a prompt.
```
Translates to:
```
Some example text.
You are an assistant helping a user write more content in a document based on a prompt.
```


## Enhanced Actions (Context)
By default, the context will be added to the end of the prompt after the default selection position:
```
Selected text with [[Some meaningful document]].

Context:
Some example context about the selected text from some meaningful document.
```

### Custom place for context
The keyword `{{=CONTEXT=}}` will be replaced with multiline string of context.
```
# Relevant context
{{=CONTEXT=}}

# Selected text
{{=SELECTION=}}
```

Translates to:
```
# Relevant context
Some example context about the selected text from some meaningful document.

# Selected text
Selected text with [[Some meaningful document]].
```

### Conditional context
Usually you want to add context conditionally, use keywords `{{=CONTEXT_START=}}` and `{{=CONTEXT_END=}}` to wrap context.

```
# Task
{{=SELECTION=}}
{{=CONTEXT_START=}}

# Context
{{=CONTEXT=}}
{{=CONTEXT_END=}}

# Instructions
Do something with the selected text.
```

🔴 If context is not empty, the entire block will be added to the prompt.
```
# Task
Selected text with [[Some meaningful document]].

# Context
Some example context about the selected text from some meaningful document.

# Instructions
Do something with the selected text.
```

⭕️ If context is empty, the entire block will not be added to the prompt.
```
# Task
Selected text with [[Some meaningful document]].

# Instructions
Do something with the selected text.
```
### Caveats

Remember that both the selection and context will be added to the end of the prompt by default if you not specify custom places for them.
```
# Task
Some task.

# Instructions
Do something with the selected text.
```
Translates to:
```
# Task
Some task.

# Instructions
Do something with the selected text.

Selected text with [[Some meaningful document]].

Context:
Some example context about the selected text from some meaningful document.
```
