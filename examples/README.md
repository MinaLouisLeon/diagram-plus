# Example diagram

`.diagrams/recipe-box.diagram.json` is a complete diagram for a small app: saving
recipes, planning a week of meals, and generating a shopping list. It exercises most
of the block types — screens, a component, endpoints, a service with pseudo-code,
four data models, config and a scheduled job.

Open it in the editor:

```bash
dgp --root examples
```

Or see exactly what Claude reads when asked to build it:

```bash
dgp spec recipe-box --root examples
```
